export type TaskStatus = 'pending' | 'running' | 'done' | 'error';

export interface Task {
  id: string;
  prompt: string;
  status: TaskStatus;
  error?: string;
}

export type MessageType = 
  | { type: 'ADD_TASK'; payload: string }
  | { type: 'REMOVE_TASK'; payload: string }
  | { type: 'CLEAR_QUEUE' }
  | { type: 'START_QUEUE' }
  | { type: 'PAUSE_QUEUE' }
  | { type: 'RESUME_QUEUE' }
  | { type: 'GET_QUEUE_STATE' }
  | { type: 'QUEUE_STATE_UPDATED'; payload: QueueState }
  | { type: 'EXECUTE_PROMPT'; payload: string }
  | { type: 'PROMPT_COMPLETED'; payload: { success: boolean; error?: string } }
  | { type: 'PING' };

export interface QueueState {
  tasks: Task[];
  isPaused: boolean;
  isRunning: boolean;
  currentTaskId: string | null;
}

export const sendMessageToBackground = async (message: MessageType, retries = 3): Promise<any> => {
  console.log('[Messaging] Sending to Background:', message);
  for (let i = 0; i < retries; i++) {
    try {
      return await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(message, (response: any) => {
          if (chrome.runtime.lastError) {
            console.warn(`[Messaging] Background attempt ${i + 1} failed:`, chrome.runtime.lastError.message);
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          console.log('[Messaging] Background response:', response);
          resolve(response);
        });
      });
    } catch (err) {
      if (i === retries - 1) {
        console.error('[Messaging] Background all retries failed:', err);
        throw err;
      }
      await new Promise(r => setTimeout(r, 500));
    }
  }
};

export const sendMessageToTab = async (tabId: number, message: MessageType, retries = 5): Promise<any> => {
  console.log(`[Messaging] Sending to Tab ${tabId}:`, message);
  for (let i = 0; i < retries; i++) {
    try {
      return await new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, message, (response: any) => {
          if (chrome.runtime.lastError) {
            console.warn(`[Messaging] Tab ${tabId} attempt ${i + 1} failed:`, chrome.runtime.lastError.message);
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          console.log(`[Messaging] Tab ${tabId} response:`, response);
          resolve(response);
        });
      });
    } catch (err) {
      if (i === retries - 1) {
        console.error(`[Messaging] Tab ${tabId} all retries failed:`, err);
        throw err;
      }
      await new Promise(r => setTimeout(r, 1000));
    }
  }
};
