import { QueueManager } from './queueManager';
import { sendMessageToTab } from '../utils/messaging';

export class Worker {
  private queueManager: QueueManager;
  private isProcessing = false;

  constructor(queueManager: QueueManager) {
    this.queueManager = queueManager;
  }

  async start() {
    if (this.isProcessing) return;
    this.isProcessing = true;
    await this.processQueue();
  }

  stop() {
    this.isProcessing = false;
  }

  private async processQueue() {
    while (this.isProcessing) {
      const state = this.queueManager.getState();
      
      if (!state.isRunning || state.isPaused) {
        this.isProcessing = false;
        break;
      }

      const nextTask = await this.queueManager.getNextPendingTask();
      if (!nextTask) {
        await this.queueManager.setRunning(false);
        this.isProcessing = false;
        break;
      }

      await this.executeTask(nextTask);
    }
  }

  private async executeTask(task: any) {
    try {
      await this.queueManager.updateTask(task.id, { status: 'running' });
      
      const tab = await this.ensureChatGPTTab();
      if (!tab.id) throw new Error('No ChatGPT tab found');

      const response = await sendMessageToTab(tab.id, { 
        type: 'EXECUTE_PROMPT', 
        payload: task.prompt 
      });

      if (response && response.success) {
        await this.queueManager.updateTask(task.id, { status: 'done' });
      } else {
        await this.queueManager.updateTask(task.id, { 
          status: 'error', 
          error: response?.error || 'Unknown error' 
        });
      }
    } catch (err: any) {
      // If the connection failed, the content script might be orphaned. 
      // We can try to reload the tab once and retry the task.
      if (err.message.includes('Could not establish connection') || err.message.includes('Receiving end does not exist')) {
        console.warn('Connection failed, attempting tab reload and retry...');
        try {
          const tab = await this.ensureChatGPTTab();
          await chrome.tabs.reload(tab.id!);
          // Wait for reload
          await new Promise((resolve) => {
            chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
              if (tabId === tab.id && info.status === 'complete') {
                chrome.tabs.onUpdated.removeListener(listener);
                resolve(null);
              }
            });
          });
          // Retry the execution once
          const retryResponse = await sendMessageToTab(tab.id!, { 
            type: 'EXECUTE_PROMPT', 
            payload: task.prompt 
          });
          if (retryResponse && retryResponse.success) {
            await this.queueManager.updateTask(task.id, { status: 'done' });
            return;
          }
        } catch (retryErr: any) {
          console.error('Retry failed:', retryErr);
        }
      }

      console.error(`Error executing task ${task.id}:`, err);
      await this.queueManager.updateTask(task.id, { 
        status: 'error', 
        error: err.message 
      });
    }
  }

  private async ensureChatGPTTab(): Promise<chrome.tabs.Tab> {
    const tabs = await chrome.tabs.query({ url: ['https://chatgpt.com/*', 'https://chat.openai.com/*'] });
    
    if (tabs.length > 0) {
      const tab = tabs[0];
      await chrome.tabs.update(tab.id!, { active: true });
      return tab;
    }

    // Open new tab if none found
    const tab = await chrome.tabs.create({ url: 'https://chatgpt.com/' });
    
    // Wait for tab to load
    return new Promise((resolve) => {
      chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
        if (tabId === tab.id && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve(tab);
        }
      });
    });
  }
}
