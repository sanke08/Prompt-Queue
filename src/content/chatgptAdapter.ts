export interface ChatGPTAdapter {
  findInput(): HTMLElement | null;
  setInputValue(el: HTMLElement, text: string): void;
  send(): boolean;
  isGenerating(): boolean;
}

export const createAdapter = (): ChatGPTAdapter => {
  return {
    findInput() {
      // Look for the main contenteditable or textarea
      // ChatGPT often uses a div with id="prompt-textarea" or similar roles
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
      if (el.tagName === 'TEXTAREA') {
        (el as HTMLTextAreaElement).value = text;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        // Contenteditable
        el.focus();
        // Clear existing content
        el.innerText = '';
        // Insert text
        const textNode = document.createTextNode(text);
        el.appendChild(textNode);
        
        // Dispatch events to trigger React's internal state updates
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    },

    send() {
      // Find the send button
      const sendSelectors = [
        'button[data-testid="send-button"]',
        'button[aria-label="Send prompt"]',
        'button:has(svg path[d*="M15.192"])', // Heuristic for the send icon
        'button.absolute.bottom-1.5' // Brittle but common
      ];

      for (const selector of sendSelectors) {
        const btn = document.querySelector(selector) as HTMLButtonElement;
        if (btn && !btn.disabled) {
          btn.click();
          return true;
        }
      }

      // Fallback: Try pressing Enter in the input
      const input = this.findInput();
      if (input) {
        const enterEvent = new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          which: 13,
          bubbles: true,
          cancelable: true
        });
        input.dispatchEvent(enterEvent);
        return true;
      }

      return false;
    },

    isGenerating() {
      // Check for the "Stop generating" button or the send button state
      const stopButton = document.querySelector('button[aria-label="Stop generating"], button[data-testid="stop-button"]');
      if (stopButton) return true;

      const sendButton = document.querySelector('button[data-testid="send-button"], button[aria-label="Send prompt"]') as HTMLButtonElement;
      if (sendButton && sendButton.disabled) {
        // If send button is disabled, it's likely generating or empty. 
        // But we just sent a prompt, so it's likely generating.
        return true;
      }

      return false;
    }
  };
};
