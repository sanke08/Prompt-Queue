/**
 * Platform adapter interface.
 * Each AI chat platform (ChatGPT, Gemini, Claude) implements this interface
 * so the content script can interact with them uniformly.
 */
export interface PlatformAdapter {
  /** Human-readable name of the platform */
  name: string;
  /** Find the main prompt input element */
  findInput(): HTMLElement | null;
  /** Set the value of the prompt input */
  setInputValue(el: HTMLElement, text: string): void;
  /** Click the send button (or press Enter). Returns true if successful. */
  send(): boolean;
  /** Returns true if the model is currently generating a response */
  isGenerating(): boolean;
}

/**
 * Dispatch a realistic Enter keypress sequence to a contenteditable / textarea.
 * Many AI sites (ChatGPT/React, Claude/ProseMirror, Gemini/Quill) branch on OS
 * and on event trust. A single bare `keydown` is ignored on macOS, so we fire
 * the full keydown -> keypress -> keyup sequence on the element AND its focused
 * target, with bubbles + cancelable so the framework's handlers actually run.
 */
export function pressEnter(el: HTMLElement): void {
  const target = (document.activeElement as HTMLElement) || el;
  const opts: KeyboardEventInit = {
    key: 'Enter',
    code: 'Enter',
    keyCode: 13,
    which: 13,
    bubbles: true,
    cancelable: true,
    composed: true,
  };
  for (const type of ['keydown', 'keypress', 'keyup'] as const) {
    target.dispatchEvent(new KeyboardEvent(type, opts));
  }
}

/**
 * Set the value of a native <textarea>/<input> through React's tracked value
 * setter so React's onChange fires. Plain `el.value = x` is swallowed by React
 * because it caches the previous value on the node.
 */
export function setNativeValue(el: HTMLTextAreaElement | HTMLInputElement, text: string): void {
  const proto = el instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) {
    setter.call(el, text);
  } else {
    el.value = text;
  }
  el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
}

/** Detect which platform we're on and return the right adapter */
export function detectPlatform(): 'chatgpt' | 'gemini' | 'claude' | null {
  const host = window.location.hostname;
  if (host.includes('chatgpt.com') || host.includes('chat.openai.com')) return 'chatgpt';
  if (host.includes('gemini.google.com')) return 'gemini';
  if (host.includes('claude.ai')) return 'claude';
  return null;
}
