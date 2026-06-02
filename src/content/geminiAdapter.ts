import type { PlatformAdapter } from './adapter';
import { pressEnter, setNativeValue } from './adapter';

export const createGeminiAdapter = (): PlatformAdapter => ({
  name: 'Gemini',

  findInput() {
    // Gemini uses a rich-text editor (contenteditable div) or a plain textarea
    const selectors = [
      '.ql-editor[contenteditable="true"]',           // Quill editor used by Gemini
      'div[contenteditable="true"].input-area',
      'rich-textarea .ql-editor',
      'div[contenteditable="true"][aria-label*="prompt"]',
      'div[contenteditable="true"][role="textbox"]',
      'textarea[aria-label*="prompt"]',
      'textarea',
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
      // Contenteditable (Quill editor). Insert via execCommand so Quill's
      // own input handler updates its internal model; fall back to innerHTML.
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.execCommand('insertText', false, text);
      if (!el.innerText.trim()) {
        el.innerHTML = `<p>${text}</p>`;
      }
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
    }
  },

  send() {
    // Gemini send button selectors
    const selectors = [
      'button[aria-label="Send message"]',
      'button.send-button',
      'button[mattooltip="Send message"]',
      '.send-button-container button',
      'button[aria-label*="Send"]',
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
    // Gemini shows a "Stop" button or a loading spinner while generating
    const stop = document.querySelector(
      'button[aria-label="Stop response"], button[aria-label="Stop"], mat-icon[data-mat-icon-name="stop_circle"]'
    );
    if (stop) return true;

    // Check for loading/thinking indicators
    const loading = document.querySelector(
      '.loading-indicator, .response-streaming, model-response .loading'
    );
    if (loading) return true;

    return false;
  }
});
