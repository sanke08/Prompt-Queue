import type { PlatformAdapter } from './adapter';

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
      (el as HTMLTextAreaElement).value = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      // ProseMirror contenteditable
      // Clear and insert using execCommand for ProseMirror compatibility
      const selection = window.getSelection();
      if (selection) {
        el.focus();
        // Select all existing content
        document.execCommand('selectAll', false);
        // Replace with new text
        document.execCommand('insertText', false, text);
      }
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
      input.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true
      }));
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
