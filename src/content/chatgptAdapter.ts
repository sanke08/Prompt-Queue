import type { PlatformAdapter } from './adapter';
import { pressEnter, setNativeValue } from './adapter';

export const createChatGPTAdapter = (): PlatformAdapter => ({
  name: 'ChatGPT',

  findInput() {
    const selectors = [
      '#prompt-textarea',
      'textarea[data-id="root"]',
      'div[contenteditable="true"][role="textbox"]',
      'textarea'
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
      // contenteditable (ProseMirror). Use execCommand so ProseMirror's own
      // input pipeline fires the native beforeinput/input events it tracks.
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.execCommand('insertText', false, text);
      // Fallback for builds where execCommand is disabled.
      if (!el.innerText.trim()) {
        el.innerHTML = `<p>${text}</p>`;
      }
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
    }
  },

  send() {
    const selectors = [
      'button[data-testid="send-button"]',
      'button[aria-label="Send prompt"]',
      'button:has(svg path[d*="M15.192"])',
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
    const stop = document.querySelector('button[aria-label="Stop generating"], button[data-testid="stop-button"]');
    if (stop) return true;
    const send = document.querySelector('button[data-testid="send-button"], button[aria-label="Send prompt"]') as HTMLButtonElement;
    if (send && send.disabled) return true;
    return false;
  }
});
