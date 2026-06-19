// Notion content script — injected on www.notion.so and app.notion.com pages.
// Receives NOTION_PASTE_IMAGE from the background worker, finds the block
// containing the prompt text, creates an empty block above it, and pastes the
// image there. Notion natively uploads images pasted from the clipboard, so we
// dispatch a synthetic `paste` event carrying the image blob in its
// clipboardData — no /image slash command needed.

// Guard against duplicate injection (executeScript called on already-injected tab)
if ((window as any).__notionQueueInjected) {
  console.log('[Notion] Already injected, skipping re-registration');
} else {
  (window as any).__notionQueueInjected = true;
  console.log('[Notion] Content script loaded');
  registerListener();
}

function registerListener() {
  let isPanelOpen = false;

  // Query initial state of the side panel
  chrome.runtime.sendMessage({ type: 'IS_PANEL_OPEN' }, (response) => {
    if (chrome.runtime.lastError) return;
    if (response && response.open !== undefined) {
      isPanelOpen = response.open;
    }
  });

  chrome.runtime.onMessage.addListener((message: any, _sender, sendResponse) => {
    if (message.type === 'PANEL_STATE_CHANGED') {
      isPanelOpen = message.payload.isOpen;
      return false;
    }

    if (message.type === 'NOTION_EXTRACT_VISUALS') {
      extractVisuals()
        .then((visuals) => sendResponse({ success: true, visuals }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true; // async response
    }

    if (message.type !== 'NOTION_PASTE_IMAGE') return false;

    const { prompt, imageDataUrl } = message.payload as {
      prompt: string;
      imageDataUrl?: string;
      imageSrc?: string;
    };

    handlePasteImage(prompt, imageDataUrl)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ success: false, error: err.message }));

    return true; // async response
  });

  // Keydown listener to handle selection capture ("a" hotkey) on Notion
  document.addEventListener(
    'keydown',
    (e: KeyboardEvent) => {
      // Only the bare "a" key — ignore Cmd/Ctrl+A (select all), Alt/Shift combos.
      if (e.key !== 'a' || e.metaKey || e.ctrlKey || e.altKey) return;
      // Only capture and intercept if the side panel is open
      if (!isPanelOpen) return;

      const selection = window.getSelection();
      const text = selection?.toString().trim() ?? '';
      if (!text) return;

      // Prevent Notion's default text-replacement behavior in the active block
      e.preventDefault();
      e.stopPropagation();

      // Send selection to background
      chrome.runtime.sendMessage(
        { type: 'CAPTURE_SELECTION', payload: { text, platform: 'chatgpt' } },
        () => {
          if (chrome.runtime.lastError) return;
        }
      );
    },
    true // capture phase to intercept before Notion's own editors handle it
  );

  async function handlePasteImage(
    prompt: string,
    imageDataUrl?: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      if (!imageDataUrl) {
        return { success: false, error: 'No image data received' };
      }

      // 1. Wait for the Notion page blocks to render
      const ready = await waitFor(
        () => document.querySelectorAll('[data-block-id]').length > 0,
        15000,
      );
      if (!ready) {
        return { success: false, error: 'Notion page not ready — no blocks found after 15s' };
      }
      await sleep(600);

      // 2. Find the specific TEXT block whose content matches the prompt.
      const targetBlock = findTextBlockByPrompt(prompt);
      if (!targetBlock) {
        return { success: false, error: `Could not find block matching: "${prompt.slice(0, 80)}"` };
      }

      // 3. Build the image blob from the background-provided data URL.
      const blob = await resolveImageBlob(imageDataUrl);
      if (!blob) {
        return { success: false, error: 'Could not build image blob from provided data' };
      }

      // 4. Decide WHERE to paste so the image lands ABOVE the prompt text.
      //    Notion inserts a pasted image as a new block immediately AFTER the
      //    block whose editable currently holds the caret. So to get the image
      //    above the prompt, we put the caret at the END of the block that comes
      //    BEFORE the prompt block. If there is no previous block (prompt is the
      //    first block), we fall back to pasting at the START of the prompt
      //    block itself (Notion then splits and the image goes above).
      const prevBlock = getPreviousLeafBlock(targetBlock);

      let pasteEditable: HTMLElement | null;
      let caretAtEnd: boolean;
      if (prevBlock) {
        pasteEditable = getEditableLeaf(prevBlock);
        caretAtEnd = true; // end of previous block → image inserts right after it
      } else {
        pasteEditable = getEditableLeaf(targetBlock);
        caretAtEnd = false; // start of prompt block
      }
      if (!pasteEditable) {
        return { success: false, error: 'Could not find editable area to paste into' };
      }

      pasteEditable.click();
      pasteEditable.focus();
      await sleep(200);
      if (caretAtEnd) {
        placeCursorAtEnd(pasteEditable);
      } else {
        placeCursorAtStart(pasteEditable);
      }
      await sleep(150);

      // Snapshot how many image blocks exist BEFORE pasting, so we can detect
      // a genuinely new one afterward (not a pre-existing image on the page).
      const imageBlocksBefore = countImageBlocks();

      // 5. Paste the image. Strategy: write the blob to the REAL system clipboard
      //    first (so a trusted Notion re-read finds it), THEN dispatch a synthetic
      //    paste event carrying the same blob. Belt and suspenders.
      const pasteTarget = (document.activeElement as HTMLElement) || pasteEditable;
      await writeImageToSystemClipboard(blob); // may no-op if not permitted
      const pasted = pasteImageBlob(pasteTarget, blob);
      if (!pasted) {
        return { success: false, error: 'Failed to dispatch paste event into Notion' };
      }

      // 7. Verify a NEW image block appeared (Notion uploads then renders it).
      const verified = await waitFor(
        () => countImageBlocks() > imageBlocksBefore,
        8000,
      );
      if (!verified) {
        return {
          success: false,
          error: 'Pasted, but no image block appeared — Notion may require the tab to be focused (synthetic paste was likely ignored)',
        };
      }

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  // -------------------------------------------------------------------------
  // Image helpers
  // -------------------------------------------------------------------------

  async function resolveImageBlob(
    imageDataUrl?: string,
  ): Promise<Blob | null> {
    // We only ever use the data: URL — the background already converted any
    // cross-origin image into one. Fetching imageSrc here would be CORS-blocked
    // on the notion.so origin, so it's intentionally not attempted.
    if (!imageDataUrl) return null;
    try {
      const res = await fetch(imageDataUrl); // fetching a data: URL is same-origin-safe
      const raw = await res.blob();
      // Normalize to PNG so Notion's image handler reliably accepts it.
      if (raw.type === 'image/png') return raw;
      return new Blob([await raw.arrayBuffer()], { type: 'image/png' });
    } catch {
      return null;
    }
  }

  // Write the image blob to the real system clipboard. If Notion responds to
  // the synthetic paste by re-reading the OS clipboard (trusted path), this
  // makes the image available there. Requires the tab to be focused; fails
  // silently otherwise (we still try the synthetic-event path afterward).
  async function writeImageToSystemClipboard(blob: Blob): Promise<void> {
    try {
      if (navigator.clipboard && (navigator.clipboard as any).write) {
        const item = new ClipboardItem({ [blob.type || 'image/png']: blob });
        await (navigator.clipboard as any).write([item]);
      }
    } catch {
      // Not focused / not permitted — ignore, synthetic event is the fallback.
    }
  }

  // Dispatch a synthetic paste event with the image attached. Notion's editor
  // listens for `paste` and uploads images found in clipboardData.files.
  function pasteImageBlob(target: HTMLElement, blob: Blob): boolean {
    try {
      const dt = new DataTransfer();
      const file = new File([blob], 'generated-image.png', { type: 'image/png' });
      dt.items.add(file);

      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: dt,
      });
      // Some builds make clipboardData read-only on construction; ensure it's set.
      if (!pasteEvent.clipboardData || pasteEvent.clipboardData.files.length === 0) {
        Object.defineProperty(pasteEvent, 'clipboardData', { value: dt });
      }

      target.focus();
      target.dispatchEvent(pasteEvent);
      return true;
    } catch {
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Block finding
  // -------------------------------------------------------------------------

  // The block types that hold text. Shared by both block-finding (paste) and
  // block-collecting (scan) so they read the SAME set of leaves.
  const LEAF_SELECTORS = [
    '[data-block-id].notion-text-block',
    '[data-block-id].notion-header-block',
    '[data-block-id].notion-sub_header-block',
    '[data-block-id].notion-sub_sub_header-block',
    '[data-block-id].notion-bulleted_list-block',
    '[data-block-id].notion-numbered_list-block',
    '[data-block-id].notion-to_do-block',
    '[data-block-id].notion-toggle-block',
    '[data-block-id].notion-quote-block',
    '[data-block-id].notion-callout-block',
  ].join(',');

  // Read text ONLY from the block's own editable leaf, never nested children.
  // Returns the trimmed text in its ORIGINAL case — callers lowercase if needed.
  function getLeafText(block: HTMLElement): string {
    const leaf =
      block.querySelector<HTMLElement>('[contenteditable="true"][role="textbox"]') ||
      block.querySelector<HTMLElement>('[contenteditable="true"]');
    return (leaf?.innerText ?? block.innerText ?? '').trim();
  }

  function findTextBlockByPrompt(prompt: string): HTMLElement | null {
    const trimmed = prompt.trim().toLowerCase();

    let blocks = Array.from(document.querySelectorAll<HTMLElement>(LEAF_SELECTORS));
    if (blocks.length === 0) {
      blocks = Array.from(document.querySelectorAll<HTMLElement>('[data-block-id]'));
    }

    // Lowercased view of a block's leaf text (this function matches case-insensitively).
    const getText = (block: HTMLElement): string => getLeafText(block).toLowerCase();

    // Every strategy iterates blocks in DOCUMENT ORDER and returns the FIRST
    // hit — so when a long prompt is split across several paragraph blocks, we
    // always anchor to the block that begins the prompt (the topmost one).

    // 1. Exact match — a block whose entire text IS the prompt.
    for (const block of blocks) {
      if (getText(block) === trimmed) return block;
    }

    // 2. Block contains the prompt's head (prompt fits in one block, maybe with
    //    extra trailing text). First 100 chars keeps it specific.
    const head = trimmed.slice(0, 100);
    for (const block of blocks) {
      if (getText(block).includes(head)) return block;
    }

    // 3. SPLIT-PROMPT case: the prompt was broken across multiple blocks. The
    //    FIRST block of the group is the one whose text the PROMPT STARTS WITH.
    //    e.g. prompt = "Create a clear ... no margin." and block 1 holds
    //    "Create a clear ... return short URL; then". We match the first block
    //    (length >= 15 to avoid trivially-short blocks) whose text begins the
    //    prompt. Returns the topmost such block = above the whole group.
    for (const block of blocks) {
      const text = getText(block);
      if (text.length >= 15 && trimmed.startsWith(text)) return block;
    }

    // 4. Reversed — a short standalone block whose text appears inside the prompt.
    for (const block of blocks) {
      const text = getText(block);
      if (text.length > 10 && trimmed.includes(text)) return block;
    }

    // 5. Token overlap (>60%). Tie-break by document order (first wins) since we
    //    only replace bestBlock on a STRICTLY higher ratio.
    const promptTokens = new Set(trimmed.split(/\s+/).filter((w) => w.length > 3));
    if (promptTokens.size === 0) return null;
    let bestBlock: HTMLElement | null = null;
    let bestRatio = 0;
    for (const block of blocks) {
      const text = getText(block);
      if (!text || text.length < 5) continue;
      let hits = 0;
      for (const t of text.split(/\s+/)) {
        if (promptTokens.has(t)) hits++;
      }
      const ratio = hits / Math.max(promptTokens.size, 1);
      if (ratio > 0.6 && ratio > bestRatio) {
        bestRatio = ratio;
        bestBlock = block;
      }
    }
    return bestBlock;
  }

  // -------------------------------------------------------------------------
  // Visual-prompt extraction (the "Scan Visuals" feature)
  // -------------------------------------------------------------------------
  //
  // Reads EVERY block on the page and returns each "[VISUAL PROMPT ...]" entry
  // as one string. Notion virtualizes long pages — only on-screen blocks exist
  // in the DOM — so we scroll the page container top-to-bottom in steps, keying
  // collected blocks by data-block-id to dedupe, until scrolling stops moving.
  //
  // A single visual prompt may be split across several paragraph blocks (the
  // same reason findTextBlockByPrompt has its split-prompt strategy). So once we
  // see a block whose text begins with "[visual prompt", we accumulate following
  // blocks until the bracket closes, then join them into one prompt.

  // Find the scrollable container that holds the page blocks. Notion uses
  // .notion-scroller for the main content area; if none is found we fall back to
  // the document scrolling element so a layout change in Notion can't silently
  // reduce the scan to a single screenful.
  function getScroller(): HTMLElement {
    const candidates = Array.from(
      document.querySelectorAll<HTMLElement>('.notion-scroller'),
    );
    // The real content scroller is the tallest one that actually scrolls.
    let best: HTMLElement | null = null;
    for (const el of candidates) {
      if (el.scrollHeight > el.clientHeight + 50) {
        if (!best || el.scrollHeight > best.scrollHeight) best = el;
      }
    }
    return best ?? (document.scrollingElement as HTMLElement) ?? document.documentElement;
  }

  async function extractVisuals(): Promise<string[]> {
    const ready = await waitFor(
      () => document.querySelectorAll('[data-block-id]').length > 0,
      15000,
    );
    if (!ready) {
      throw new Error('Notion page not ready — no blocks found after 15s');
    }
    await sleep(600);

    // Collect block text in document order, deduped by id. A Map preserves
    // insertion order, and re-collecting an already-seen id is a no-op — so the
    // final ordering reflects the first time each block scrolled into view,
    // which for a top-to-bottom scroll is document order. We collect from the
    // SAME leaf selectors the paste-side block finder uses (LEAF_SELECTORS), so
    // both sides agree on what a text block is.
    const collected = new Map<string, string>();
    const collectVisible = () => {
      let blocks = Array.from(document.querySelectorAll<HTMLElement>(LEAF_SELECTORS));
      if (blocks.length === 0) {
        blocks = Array.from(document.querySelectorAll<HTMLElement>('[data-block-id]'));
      }
      for (const b of blocks) {
        const id = b.getAttribute('data-block-id');
        if (!id || collected.has(id)) continue;
        collected.set(id, getLeafText(b));
      }
    };

    const scroller = getScroller();
    collectVisible();

    const step = Math.max(scroller.clientHeight - 100, 300);
    let pos = 0;
    let lastScrollTop = -1;
    // Guard against runaway loops on pathological pages.
    for (let i = 0; i < 500; i++) {
      scroller.scrollTo({ top: pos, behavior: 'auto' });
      await sleep(250); // let virtualized blocks render
      collectVisible();
      // Stop when the scroller can't advance any further.
      if (scroller.scrollTop === lastScrollTop) break;
      lastScrollTop = scroller.scrollTop;
      if (pos >= scroller.scrollHeight) break;
      pos += step;
    }
    // Final pass at the very bottom to catch the last screenful.
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'auto' });
    await sleep(250);
    collectVisible();
    // Be a good citizen — return the user's view to the top.
    scroller.scrollTo({ top: 0, behavior: 'auto' });

    // Reassemble visual prompts from the ordered block texts.
    const texts = Array.from(collected.values());
    const visuals: string[] = [];
    const START = '[visual prompt';

    // A visual prompt ENDS at the first block containing the closing ']'. We
    // terminate on the first ']' rather than balancing bracket counts because:
    //   - it handles the common single-block case (the marker block already
    //     holds the ']' → the entry is complete immediately), and
    //   - it is robust to literal '[' or ']' INSIDE the description text
    //     (e.g. "arr[i]"): a balanced-depth counter would miscount those, but
    //     "first closing bracket wins" still ends the entry correctly.
    // Two safety rails stop a prompt whose ']' was never captured (split off-
    // screen, or simply absent) from swallowing the rest of the page:
    //   - a new '[visual prompt' marker ends the current entry, and
    //   - MAX_CONTINUATION caps how many follow-on blocks we will absorb.
    const MAX_CONTINUATION = 40;

    for (let i = 0; i < texts.length; i++) {
      const text = texts[i];
      if (!text) continue;
      if (!text.toLowerCase().startsWith(START)) continue;

      let combined = text;
      let j = i;
      // If the opening block already closes the bracket, it's a complete
      // single-block prompt and we accumulate nothing.
      if (!text.includes(']')) {
        while (j + 1 < texts.length && j - i < MAX_CONTINUATION) {
          const next = texts[j + 1];
          // A new visual prompt starting means this one was unterminated; stop
          // before it so we don't swallow the next entry.
          if (next.toLowerCase().startsWith(START)) break;
          j++;
          combined += '\n' + next;
          if (next.includes(']')) break; // closing bracket reached
        }
      }
      visuals.push(combined.trim());
      i = j; // resume after the consumed group
    }

    return visuals;
  }

  function getEditableLeaf(block: HTMLElement): HTMLElement | null {
    return (
      block.querySelector<HTMLElement>('[contenteditable="true"][role="textbox"]') ||
      block.querySelector<HTMLElement>('[contenteditable="true"]') ||
      null
    );
  }

  // Did a Notion image block appear? Confirmed DOM from a successful manual
  // paste: a sibling block with class "notion-image-block" containing an <img>.
  // We snapshot the image-block count before pasting and compare after.
  function countImageBlocks(): number {
    return document.querySelectorAll('.notion-image-block').length;
  }

  // -------------------------------------------------------------------------
  // Cursor / keyboard helpers
  // -------------------------------------------------------------------------

  function placeCursorAtStart(editable: HTMLElement) {
    const selection = window.getSelection();
    if (!selection) return;
    try {
      const range = document.createRange();
      const firstChild = editable.firstChild ?? editable;
      range.setStart(firstChild, 0);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    } catch {
      editable.click();
    }
  }

  function placeCursorAtEnd(editable: HTMLElement) {
    const selection = window.getSelection();
    if (!selection) return;
    try {
      const range = document.createRange();
      range.selectNodeContents(editable);
      range.collapse(false); // collapse to the END
      selection.removeAllRanges();
      selection.addRange(range);
    } catch {
      editable.click();
    }
  }

  // Find the leaf block that visually precedes the given block. Notion wraps
  // each block in a .notion-selectable[data-block-id]; the previous block is
  // the previous such element in document order. We walk the flat list of all
  // [data-block-id] leaf blocks and return the one before `block`.
  function getPreviousLeafBlock(block: HTMLElement): HTMLElement | null {
    const blockId = block.getAttribute('data-block-id');
    if (!blockId) return null;
    const all = Array.from(
      document.querySelectorAll<HTMLElement>('[data-block-id]'),
    ).filter((b) => getEditableLeaf(b) !== null); // only blocks with an editable leaf
    const idx = all.findIndex((b) => b === block);
    if (idx > 0) return all[idx - 1];
    return null;
  }

  // -------------------------------------------------------------------------
  // Utility
  // -------------------------------------------------------------------------

  function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  function waitFor(condition: () => boolean, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      if (condition()) {
        resolve(true);
        return;
      }
      const interval = setInterval(() => {
        if (condition()) {
          clearInterval(interval);
          resolve(true);
        }
      }, 200);
      setTimeout(() => {
        clearInterval(interval);
        resolve(false);
      }, timeoutMs);
    });
  }
} // end registerListener
