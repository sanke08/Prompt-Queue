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
});

async function handleExecutePrompt(prompt: string) {
  if (!adapter) {
    return { success: false, error: 'No adapter found for this platform' };
  }

  try {
    const input = adapter.findInput();
    if (!input) {
      return { success: false, error: `Could not find input box on ${adapter.name}` };
    }

    // Check if input is empty to avoid overwriting user's active typing
    const currentText = (input as any).innerText || (input as any).value || "";
    if (currentText.trim().length > 0) {
      return { success: false, error: "Input is not empty (User may be typing). Retrying..." };
    }

    adapter.setInputValue(input, prompt);

    // Delay to let the framework pick up the value
    await new Promise(r => setTimeout(r, 500));

    const sent = adapter.send();
    if (!sent) {
      return { success: false, error: `Failed to click send on ${adapter.name}` };
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
