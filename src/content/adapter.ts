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

/** Detect which platform we're on and return the right adapter */
export function detectPlatform(): 'chatgpt' | 'gemini' | 'claude' | null {
  const host = window.location.hostname;
  if (host.includes('chatgpt.com') || host.includes('chat.openai.com')) return 'chatgpt';
  if (host.includes('gemini.google.com')) return 'gemini';
  if (host.includes('claude.ai')) return 'claude';
  return null;
}
