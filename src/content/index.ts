import type { PlatformAdapter } from './adapter';
import { detectPlatform } from './adapter';
import { createChatGPTAdapter } from './chatgptAdapter';
import { createGeminiAdapter } from './geminiAdapter';
import { createClaudeAdapter } from './claudeAdapter';
import { waitForCompletion } from './observer';
import type { MessageType } from '../utils/messaging';

const platform = detectPlatform();
let adapter: PlatformAdapter | null = null;

if (platform === 'chatgpt') adapter = createChatGPTAdapter();
else if (platform === 'gemini') adapter = createGeminiAdapter();
else if (platform === 'claude') adapter = createClaudeAdapter();

console.log(`[Queue Automator] Content script loaded on: ${platform ?? 'unknown'}`);

chrome.runtime.onMessage.addListener((message: MessageType, _sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
  console.log('[Content] Received message:', message);
  if (message.type === 'EXECUTE_PROMPT') {
    const { prompt, captureImage } = message.payload;
    handleExecutePrompt(prompt, captureImage)
      .then(res => {
        console.log('[Content] Execution response:', res);
        sendResponse(res);
      })
      .catch(err => {
        console.error('[Content] Execution error:', err);
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }

  if (message.type === 'PING') {
    console.log('[Content] Responding to PING');
    sendResponse({ success: true, platform });
    return true;
  }

  if (message.type === 'CAPTURE_IMAGE') {
    const imageCountBefore = message.payload?.imageCountBefore ?? 0;
    captureLatestImage(imageCountBefore)
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

// --- "a" hotkey: send the current page selection to the side panel's prompt box ---
// Only fires when the side panel is open (the background tracks this) and the
// user is NOT typing into an editable element on the page.
function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    el.isContentEditable === true
  );
}

document.addEventListener(
  'keydown',
  (e: KeyboardEvent) => {
    // Only the bare "a" key — ignore Cmd/Ctrl+A (select all), Alt/Shift combos.
    if (e.key !== 'a' || e.metaKey || e.ctrlKey || e.altKey) return;
    // Don't hijack typing in page inputs / chat boxes.
    if (isEditableTarget(e.target) || isEditableTarget(document.activeElement)) return;

    // Only meaningful on a recognized chat page (we need a platform to queue).
    if (!platform) return;

    const selection = window.getSelection();
    const text = selection?.toString().trim() ?? '';
    if (!text) return;

    // Ask the background to relay this to the panel. If the panel is closed,
    // the background returns { open: false } and nothing happens. We only get
    // here when the target is non-editable, so there's no typing to suppress.
    chrome.runtime.sendMessage(
      { type: 'CAPTURE_SELECTION', payload: { text, platform } },
      () => {
        if (chrome.runtime.lastError) return;
      },
    );
  },
  true, // capture phase, so we see it before the page's own handlers
);

function getImageCandidates(): HTMLImageElement[] {
  return Array.from(document.querySelectorAll<HTMLImageElement>('img')).filter((img) => {
    if (!img.src || img.src.startsWith('data:image/svg')) return false;
    if (img.naturalWidth < 100 || img.naturalHeight < 100) return false;
    if (img.complete === false) return false;
    if (img.naturalWidth <= 64 && img.naturalHeight <= 64) return false;
    return true;
  });
}

// Scan the page for a newly generated image.
// imageCountBefore: how many qualifying images were on the page BEFORE the
// prompt was sent. We poll until a new one appears, so we never capture a
// leftover image from the previous prompt.
async function captureLatestImage(imageCountBefore = 0): Promise<{ success: boolean; imageDataUrl?: string; imageSrc?: string; error?: string }> {
  try {
    // Wait up to 90s for a new image to appear beyond the baseline count.
    const TIMEOUT = 90_000;
    const POLL = 1_000;
    const deadline = Date.now() + TIMEOUT;

    let candidates = getImageCandidates();
    while (candidates.length <= imageCountBefore) {
      if (Date.now() > deadline) {
        return { success: false, error: 'Timed out waiting for a new generated image' };
      }
      await new Promise(r => setTimeout(r, POLL));
      candidates = getImageCandidates();
    }

    // Pick the newest image — last in document order.
    const img = candidates[candidates.length - 1];

    // Try same-origin canvas capture first (works for Gemini which serves
    // images from the same domain). For cross-origin images this throws —
    // in that case we return the src URL and let the background fetch it.
    try {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        const dataUrl = canvas.toDataURL('image/png');
        return { success: true, imageDataUrl: dataUrl };
      }
    } catch (canvasErr: any) {
      if (canvasErr.name !== 'SecurityError') throw canvasErr;
      // Cross-origin — fall through to URL-based capture
    }

    // Return the raw src so the background can fetch it with full permissions
    return { success: true, imageSrc: img.src };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

async function handleExecutePrompt(
  prompt: string,
  captureImage = false,
): Promise<{ success: boolean; error?: string; imageDataUrl?: string; imageSrc?: string }> {
  if (!adapter) {
    return { success: false, error: 'No adapter found for this platform' };
  }

  try {
    // Snapshot image count NOW — before injecting the prompt — so we can
    // identify the image that belongs specifically to this prompt later.
    // This must happen before send() so there is zero ambiguity.
    const imageCountBefore = captureImage ? getImageCandidates().length : 0;

    // 1. Wait for input box to appear (SPAs can be slow)
    let input: HTMLElement | null = null;
    let retries = 30; // 15 seconds total

    while (retries > 0) {
      input = adapter.findInput();
      if (input) break;

      // Check for Sign-in buttons while waiting
      const isSignedOut = !!document.querySelector('a[href*="accounts.google.com"], [href*="login"], [href*="sign-in"], .sign-in-button');
      if (isSignedOut && !document.querySelector('rich-textarea, .ql-editor, textarea')) {
         return { success: false, error: "Please sign in to the AI platform first." };
      }

      await new Promise(r => setTimeout(r, 500));
      retries--;
    }

    if (!input) {
      return { success: false, error: `Could not find input box on ${adapter.name}. Please ensure you are logged in.` };
    }

    // 2. Avoid overwriting text the USER is actively typing — but NOT our own
    //    leftover prompt. A previous attempt may have set the value without it
    //    being sent/cleared (e.g. the send click didn't land); in that case the
    //    box holds OUR prompt and we should just (re)send it, not bail and retry
    //    forever. So only treat the box as "busy" when it contains text that is
    //    neither empty nor the prompt we're about to inject.
    const currentText = ((input as any).innerText || (input as any).value || "").trim();
    // Rich editors (ProseMirror/Quill/rich-textarea) normalize whitespace and
    // newlines when rendering, so compare with whitespace collapsed rather than
    // requiring an exact byte match against the prompt we sent.
    const normalize = (s: string) => s.replace(/\s+/g, " ").trim();
    const isOurOwnPrompt = normalize(currentText) === normalize(prompt);
    if (currentText.length > 0 && !isOurOwnPrompt) {
      return { success: false, error: "Input is not empty (User may be typing). Retrying..." };
    }

    // Only re-inject when the box isn't already holding exactly our prompt;
    // re-setting identical text can retrigger the framework's input handlers
    // and clobber the editor's caret/state on some platforms.
    if (!isOurOwnPrompt) {
      adapter.setInputValue(input, prompt);
    }

    // Delay to let the framework pick up the value
    await new Promise(r => setTimeout(r, 800));

    const sent = adapter.send();
    if (!sent) {
      return { success: false, error: `Failed to click send on ${adapter.name}` };
    }

    // Wait for generation to start
    await new Promise(r => setTimeout(r, 1500));

    // Wait for completion
    await waitForCompletion(adapter);

    // If the background wants an image, capture it now — in the same execution
    // context, using the baseline we snapshotted before sending. This guarantees
    // the image belongs to THIS prompt, not any previous one.
    if (captureImage) {
      const imageResult = await captureLatestImage(imageCountBefore);
      return imageResult;
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
