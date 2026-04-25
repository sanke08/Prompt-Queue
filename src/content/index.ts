import { createAdapter } from './chatgptAdapter';
import { waitForCompletion } from './observer';
import type { MessageType } from '../utils/messaging';

console.log('ChatGPT Queue Automator: Content script loaded');

const adapter = createAdapter();

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
    return true; // Keep channel open for async response
  }

  if (message.type === 'PING') {
    console.log('[Content] Responding to PING');
    sendResponse({ success: true });
    return true;
  }
});

async function handleExecutePrompt(prompt: string) {
  try {
    const input = adapter.findInput();
    if (!input) {
      return { success: false, error: 'Could not find input box' };
    }

    adapter.setInputValue(input, prompt);
    
    // Small delay to ensure React picks up the value
    await new Promise(r => setTimeout(r, 500));

    const sent = adapter.send();
    if (!sent) {
      return { success: false, error: 'Failed to click send button' };
    }

    // Wait for generation to start
    await new Promise(r => setTimeout(r, 1000));

    // Wait for completion
    await waitForCompletion(adapter);

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
