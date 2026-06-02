import type { PlatformAdapter } from './adapter';
import { pressEnter, setNativeValue } from './adapter';

export const createClaudeAdapter = (): PlatformAdapter => ({
  name: 'Claude',

  findInput() {
    // Claude uses a contenteditable div as the main input
    const selectors = [
      'div[contenteditable="true"].ProseMirror',      // Claude's ProseMirror editor
      'div[contenteditable="true"][aria-label*="message"]',
      'div[contenteditable="true"][data-placeholder]',
      'fieldset div[contenteditable="true"]',
      'div[contenteditable="true"]',
    ];
    for (const selector of selectors) {
      const el = document.querySelector(selector) as HTMLElement;
      if (el) return el;
    }
    return null;
  },

  setInputValue(el: HTMLElement, text: string) {
    el.focus();
    if (el.tagName === 'TEXTAREA') {
      setNativeValue(el as HTMLTextAreaElement, text);
    } else {
      // ProseMirror contenteditable. Select existing content via a Range
      // (more reliable on macOS than execCommand('selectAll')) then insert.
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.execCommand('insertText', false, text);
      // Fallback for builds where execCommand is a no-op: write paragraphs
      // and fire the beforeinput/input events ProseMirror tracks.
      if (!el.innerText.trim()) {
        el.innerHTML = `<p>${text}</p>`;
      }
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
    }
  },

  send() {
    // Claude send button selectors
    const selectors = [
      'button[aria-label="Send Message"]',
      'button[aria-label="Send message"]',
      'button[aria-label*="Send"]',
      'fieldset button[type="button"]:last-child',
    ];
    for (const selector of selectors) {
      const btn = document.querySelector(selector) as HTMLButtonElement;
      if (btn && !btn.disabled) { btn.click(); return true; }
    }
    // Fallback: Enter key
    const input = this.findInput();
    if (input) {
      input.focus();
      pressEnter(input);
      return true;
    }
    return false;
  },

  isGenerating() {
    // Claude shows a "Stop" button while generating
    const stop = document.querySelector(
      'button[aria-label="Stop Response"], button[aria-label="Stop response"], button[aria-label*="Stop"]'
    );
    if (stop) return true;

    // Check for the streaming indicator
    const streaming = document.querySelector(
      '[data-is-streaming="true"], .animate-pulse'
    );
    if (streaming) return true;

    return false;
  }
});
