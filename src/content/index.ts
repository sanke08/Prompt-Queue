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
    handleExecutePrompt(message.payload)
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
    captureLatestImage()
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

// Scan the page for the most recently generated image and return its src URL.
// We intentionally return the URL only — the background worker fetches it,
// avoiding the cross-origin SecurityError that canvas.toDataURL() throws for
// images served from CDNs like files.oaiusercontent.com (ChatGPT/DALL-E).
async function captureLatestImage(): Promise<{ success: boolean; imageDataUrl?: string; imageSrc?: string; error?: string }> {
  try {
    const imgs = Array.from(document.querySelectorAll<HTMLImageElement>('img'));

    const candidates = imgs.filter((img) => {
      if (!img.src || img.src.startsWith('data:image/svg')) return false;
      if (img.naturalWidth < 100 || img.naturalHeight < 100) return false;
      if (img.complete === false) return false;
      if (img.naturalWidth <= 64 && img.naturalHeight <= 64) return false;
      return true;
    });

    if (candidates.length === 0) {
      return { success: false, error: 'No generated image found on page' };
    }

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

async function handleExecutePrompt(prompt: string) {
  if (!adapter) {
    return { success: false, error: 'No adapter found for this platform' };
  }

  try {
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

    // 2. Check if input is empty to avoid overwriting user's active typing
    const currentText = (input as any).innerText || (input as any).value || "";
    if (currentText.trim().length > 0) {
      return { success: false, error: "Input is not empty (User may be typing). Retrying..." };
    }

    adapter.setInputValue(input, prompt);

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

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
