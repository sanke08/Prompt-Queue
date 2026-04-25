import { QueueManager } from './queueManager';
import { sendMessageToTab } from '../utils/messaging';
import type { AIPlatform } from '../utils/messaging';

export class Worker {
  private queueManager: QueueManager;
  private processingPlatforms = new Set<AIPlatform>();

  constructor(queueManager: QueueManager) {
    this.queueManager = queueManager;
  }

  async start() {
    const platforms: AIPlatform[] = ['chatgpt', 'gemini', 'claude'];
    for (const platform of platforms) {
      if (!this.processingPlatforms.has(platform)) {
        this.processPlatformQueue(platform);
      }
    }
  }

  private async processPlatformQueue(platform: AIPlatform) {
    if (this.processingPlatforms.has(platform)) return;
    this.processingPlatforms.add(platform);

    console.log(`[Worker] Started queue for ${platform}`);

    try {
      while (true) {
        const next = await this.queueManager.getNextPendingTaskForPlatform(platform);
        
        if (!next) {
          console.log(`[Worker] No more tasks for ${platform}`);
          break;
        }

        const { task, project } = next;
        await this.executeTask(task, project);
        
        // Small delay between tasks
        await new Promise(r => setTimeout(r, 1500));
      }
    } finally {
      this.processingPlatforms.delete(platform);
      console.log(`[Worker] Stopped queue for ${platform}`);
    }
  }

  private async executeTask(task: any, project: any) {
    try {
      await this.queueManager.updateTask(task.id, { status: 'running' });
      
      // Use project targetUrl if task doesn't have one
      const effectiveUrl = task.targetUrl || project?.targetUrl;
      
      const tab = await this.ensureAITab(task.platform, effectiveUrl);
      if (!tab.id) throw new Error('No AI chat tab found');

      // Check for Input Collision: wait if busy or not empty
      let response = null;
      let executeRetries = 5;
      
      while (executeRetries > 0) {
        response = await sendMessageToTab(tab.id, { 
          type: 'EXECUTE_PROMPT', 
          payload: task.prompt 
        });

        if (response && !response.success && response.error?.includes("Input is not empty")) {
          console.warn(`[Worker] Input busy on ${task.platform}, retrying in 3s... (${executeRetries} left)`);
          await new Promise(r => setTimeout(r, 3000));
          executeRetries--;
        } else {
          break;
        }
      }

      if (response && response.success) {
        await this.queueManager.updateTask(task.id, { status: 'done' });
        
        // After task in a non-locked project, capture the URL
        if (project && !project.targetUrl) {
          const capturedUrl = await this.waitForUrlChange(tab.id);
          if (capturedUrl) {
             await this.queueManager.updateProjectTargetUrl(project.id, capturedUrl);
          }
        }
      } else {
        await this.queueManager.updateTask(task.id, { 
          status: 'error', 
          error: response?.error || 'Unknown error' 
        });
      }
    } catch (err: any) {
      console.error(`Error executing task ${task.id}:`, err);
      await this.queueManager.updateTask(task.id, { 
        status: 'error', 
        error: err.message 
      });
    }
  }

  private async waitForUrlChange(tabId: number, timeoutMs = 15000): Promise<string | null> {
    return new Promise((resolve) => {
      const startTime = Date.now();
      
      const checkUrl = async () => {
        try {
          const tab = await chrome.tabs.get(tabId);
          if (tab.url && !this.isNewChatUrl(tab.url)) {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve(tab.url);
            return true;
          }
        } catch (e) {
          // Tab might have been closed
          chrome.tabs.onUpdated.removeListener(listener);
          resolve(null);
          return true;
        }
        return false;
      };

      const listener = (updatedTabId: number, changeInfo: any) => {
        if (updatedTabId === tabId && changeInfo.url) {
           if (!this.isNewChatUrl(changeInfo.url)) {
             chrome.tabs.onUpdated.removeListener(listener);
             resolve(changeInfo.url);
           }
        }
      };

      chrome.tabs.onUpdated.addListener(listener);

      // Periodic check as fallback for onUpdated
      const interval = setInterval(async () => {
        if (await checkUrl() || (Date.now() - startTime) > timeoutMs) {
          clearInterval(interval);
          chrome.tabs.onUpdated.removeListener(listener);
          resolve(null);
        }
      }, 1000);
    });
  }

  private static readonly PLATFORM_CONFIG: Record<string, { patterns: string[]; defaultUrl: string }> = {
    chatgpt: { patterns: ['https://chatgpt.com/*', 'https://chat.openai.com/*'], defaultUrl: 'https://chatgpt.com/' },
    gemini:  { patterns: ['https://gemini.google.com/*'], defaultUrl: 'https://gemini.google.com/app' },
    claude:  { patterns: ['https://claude.ai/*'], defaultUrl: 'https://claude.ai/new' },
  };

  private async ensureAITab(platform: string, targetUrl?: string): Promise<chrome.tabs.Tab> {
    const config = Worker.PLATFORM_CONFIG[platform] || Worker.PLATFORM_CONFIG.chatgpt;

    // 1. If specific URL is required, find it
    if (targetUrl) {
      const tabs = await chrome.tabs.query({ url: targetUrl });
      if (tabs.length > 0) {
        const tab = tabs[0];
        await chrome.tabs.update(tab.id!, { active: true });
        return tab;
      }
    }

    // 2. Search for any tab matching this platform
    const tabs = await chrome.tabs.query({ url: config.patterns });
    if (tabs.length > 0) {
      const tab = tabs[0];
      await chrome.tabs.update(tab.id!, { active: true });
      
      // Navigate if we have a targetUrl but tab is elsewhere
      if (targetUrl && tab.url !== targetUrl) {
        await chrome.tabs.update(tab.id!, { url: targetUrl });
        return this.waitForTabComplete(tab.id!);
      }
      return tab;
    }

    // 3. Open new tab
    const tab = await chrome.tabs.create({ url: targetUrl || config.defaultUrl });
    return this.waitForTabComplete(tab.id!);
  }

  private async waitForTabComplete(tabId: number): Promise<chrome.tabs.Tab> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        reject(new Error('Tab timeout'));
      }, 30000);

      function listener(id: number, info: any) {
        if (id === tabId && info.status === 'complete') {
          clearTimeout(timeout);
          chrome.tabs.onUpdated.removeListener(listener);
          chrome.tabs.get(tabId).then(resolve);
        }
      }
      chrome.tabs.onUpdated.addListener(listener);
    });
  }

  private isNewChatUrl(url: string): boolean {
    const newChatPatterns = [
        'chatgpt.com/?$',
        'chatgpt.com/$',
        'chat.openai.com/?$',
        'chat.openai.com/$',
        'gemini.google.com/app$',
        'claude.ai/new$',
        'claude.ai/chat$'
    ];
    return newChatPatterns.some(p => new RegExp(p).test(url));
  }
}
