import { QueueManager } from "./queueManager";
import { sendMessageToTab } from "../utils/messaging";
import type { AIPlatform } from "../utils/messaging";

export class Worker {
  private queueManager: QueueManager;
  private processingPlatforms = new Set<AIPlatform>();

  constructor(queueManager: QueueManager) {
    this.queueManager = queueManager;
  }

  async start() {
    const platforms: AIPlatform[] = ["chatgpt", "gemini", "claude"];
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
        const next =
          await this.queueManager.getNextPendingTaskForPlatform(platform);

        if (!next) {
          console.log(`[Worker] No more tasks for ${platform}`);
          break;
        }

        const { task, project } = next;
        await this.executeTask(task, project);

        // Small delay between tasks
        await new Promise((r) => setTimeout(r, 1500));
      }
    } finally {
      this.processingPlatforms.delete(platform);
      console.log(`[Worker] Stopped queue for ${platform}`);
    }
  }

  private async executeTask(task: any, project: any) {
    try {
      // 1. Initial State Check
      const currentProject = this.queueManager
        .getState()
        .projects.find((p) => p.id === project.id);
      const currentTask = this.queueManager
        .getState()
        .tasks.find((t) => t.id === task.id);

      if (
        !currentProject?.isRunning ||
        currentProject?.isPaused ||
        !currentTask
      ) {
        return;
      }

      await this.queueManager.updateTask(task.id, {
        status: "running",
        statusDetail: "Initializing tab...",
      });

      const effectiveUrl = project?.targetUrl;
      const tab = await this.ensureAITab(task.platform, effectiveUrl);
      const tabId = tab.id;
      if (tabId === undefined) throw new Error("No AI chat tab found");

      // Verify connection to content script
      try {
        await sendMessageToTab(tabId, { type: 'PING' }, 2);
      } catch (e) {
        console.log("Ping failed, reloading tab...");
        await chrome.tabs.reload(tabId);
        await this.waitForTabComplete(tabId);
        // Extra buffer for content script to attach
        await new Promise((r) => setTimeout(r, 2000));
      }

      // 2. Pre-Injection Check
      const stillRunning = this.queueManager
        .getState()
        .projects.find((p) => p.id === project.id)?.isRunning;
      if (
        !stillRunning ||
        !this.queueManager.getState().tasks.find((t) => t.id === task.id)
      ) {
        return;
      }

      await this.queueManager.updateTask(task.id, {
        statusDetail: `Injecting prompt to ${task.platform}...`,
      });

      let response = null;
      let executeRetries = 5;

      while (executeRetries > 0) {
        response = await sendMessageToTab(tabId, {
          type: "EXECUTE_PROMPT",
          payload: task.prompt,
        });

        if (
          response &&
          !response.success &&
          response.error?.includes("Input is not empty")
        ) {
          await this.queueManager.updateTask(task.id, {
            statusDetail: `Input busy, retrying... (${executeRetries})`,
          });
          await new Promise((r) => setTimeout(r, 3000));
          executeRetries--;
        } else {
          break;
        }
      }

      // 3. Post-Injection Check
      const stillRunningPost = this.queueManager
        .getState()
        .projects.find((p) => p.id === project.id)?.isRunning;
      if (
        !stillRunningPost ||
        !this.queueManager.getState().tasks.find((t) => t.id === task.id)
      ) {
        return;
      }

      if (response && response.success) {
        await this.queueManager.updateTask(task.id, {
          statusDetail: "Waiting for AI response...",
        });

        // The content script will handle waiting for completion
        // but we can add an extra wait here for safety
        await new Promise((r) => setTimeout(r, 2000));

        await this.queueManager.updateTask(task.id, {
          status: "done",
          statusDetail: "Completed",
        });

        if (
          project &&
          (!project.targetUrl ||
            (project.targetUrl && this.isNewChatUrl(project.targetUrl)))
        ) {
          await this.queueManager.updateTask(task.id, {
            statusDetail: "Capturing chat ID...",
          });
          const capturedUrl = await this.waitForUrlChange(tabId);
          if (capturedUrl) {
            await this.queueManager.updateProjectTargetUrl(
              project.id,
              capturedUrl,
            );
          }
        }

        // Check if this was the last task to send notification and stop project
        const nextTask = await this.queueManager.getNextPendingTask(project.id);
        if (!nextTask) {
          await this.queueManager.setRunning(false, project.id);
          this.sendCompletionNotification(project.name);
        }
      } else {
        await this.queueManager.updateTask(task.id, {
          status: "error",
          error: response?.error || "Unknown error",
          statusDetail: "Execution failed",
        });
      }
    } catch (err: any) {
      console.error(`Error executing task ${task.id}:`, err);

      // If it's a connection error, it might be because the tab was closed or navigated
      // We could try to recover once, but for now we mark as error with a clear message
      const isConnectionError =
        err.message?.includes("Receiving end does not exist") ||
        err.message?.includes("connection");

      await this.queueManager.updateTask(task.id, {
        status: "error",
        error: isConnectionError
          ? "Lost connection to tab. Please make sure the AI page is open and you are logged in."
          : err.message,
        statusDetail: "Critical error",
      });
    }
  }

  private sendCompletionNotification(projectName: string) {
    if (typeof chrome !== "undefined" && chrome.notifications) {
      chrome.notifications.create({
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: "Project Completed",
        message: `All tasks in "${projectName}" have been finished.`,
        priority: 2,
      });
    }
  }

  private async waitForUrlChange(
    tabId: number,
    timeoutMs = 15000,
  ): Promise<string | null> {
    return new Promise((resolve) => {
      const startTime = Date.now();
      let isResolved = false;

      const finish = (url: string | null) => {
        if (isResolved) return;
        isResolved = true;
        chrome.tabs.onUpdated.removeListener(listener);
        clearInterval(interval);
        resolve(url);
      };

      const checkUrl = async () => {
        try {
          const tab = await chrome.tabs.get(tabId);
          if (tab.url && !this.isNewChatUrl(tab.url)) {
            finish(tab.url);
            return true;
          }
        } catch (e) {
          finish(null);
          return true;
        }
        return false;
      };

      const listener = (updatedTabId: number, changeInfo: any) => {
        if (updatedTabId === tabId && changeInfo.url) {
          if (!this.isNewChatUrl(changeInfo.url)) {
            finish(changeInfo.url);
          }
        }
      };

      chrome.tabs.onUpdated.addListener(listener);

      const interval = setInterval(async () => {
        if (!(await checkUrl()) && Date.now() - startTime > timeoutMs) {
          finish(null);
        }
      }, 1000);
    });
  }

  private static readonly PLATFORM_CONFIG: Record<
    string,
    { patterns: string[]; defaultUrl: string }
  > = {
    chatgpt: {
      patterns: ["https://chatgpt.com/*", "https://chat.openai.com/*"],
      defaultUrl: "https://chatgpt.com/",
    },
    gemini: {
      patterns: ["https://gemini.google.com/*"],
      defaultUrl: "https://gemini.google.com/app",
    },
    claude: {
      patterns: ["https://claude.ai/*"],
      defaultUrl: "https://claude.ai/new",
    },
  };

  private async ensureAITab(
    platform: string,
    targetUrl?: string,
  ): Promise<chrome.tabs.Tab> {
    const config =
      Worker.PLATFORM_CONFIG[platform] || Worker.PLATFORM_CONFIG.chatgpt;

    // 1. SPECIFIC LOCK: User wants to run in a specific pre-existing chat
    if (targetUrl && !this.isNewChatUrl(targetUrl)) {
      const allTabs = await chrome.tabs.query({});
      const targetBase = targetUrl.split('?')[0].replace(/\/$/, '');
      
      const matchingTab = allTabs.find(t => {
        if (!t.url) return false;
        const tabBase = t.url.split('?')[0].replace(/\/$/, '');
        return tabBase === targetBase;
      });

      if (matchingTab) {
        await chrome.tabs.update(matchingTab.id!, { active: true });
        if (matchingTab.windowId) {
          await chrome.windows.update(matchingTab.windowId, { focused: true });
        }
        return this.waitForTabComplete(matchingTab.id!);
      }

      // If specific lock tab not found, try any platform tab or create new
      const platformTabsFound = await chrome.tabs.query({ url: config.patterns });
      if (platformTabsFound.length > 0) {
        const tab = platformTabsFound[0];
        await chrome.tabs.update(tab.id!, { active: true, url: targetUrl });
        if (tab.windowId) {
          await chrome.windows.update(tab.windowId, { focused: true });
        }
        return this.waitForTabComplete(tab.id!);
      }
      const tab = await chrome.tabs.create({ url: targetUrl, active: true });
      if (tab.windowId) {
        await chrome.windows.update(tab.windowId, { focused: true });
      }
      return this.waitForTabComplete(tab.id!);
    }

    // 2. NO LOCK OR GENERIC LOCK: Must start a NEW chat session
    const platformTabs = await chrome.tabs.query({ url: config.patterns });

    // Try to find a tab that is ALREADY on a New Chat page (Clean and ready)
    const cleanTab = platformTabs.find(
      (t) => t.url && this.isNewChatUrl(t.url) && !this.isAuthUrl(t.url),
    );

    if (cleanTab) {
      await chrome.tabs.update(cleanTab.id!, { active: true });
      if (cleanTab.windowId) {
        await chrome.windows.update(cleanTab.windowId, { focused: true });
      }
      return cleanTab;
    }

    // No clean tab found. Create a BRAND NEW tab to avoid hijacking user's existing chats.
    const tab = await chrome.tabs.create({ url: config.defaultUrl, active: true });
    if (tab.windowId) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
    return this.waitForTabComplete(tab.id!);
  }

  private async waitForTabComplete(tabId: number): Promise<chrome.tabs.Tab> {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === "complete") {
      await new Promise(r => setTimeout(r, 500)); // Small settle delay
      return tab;
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        reject(new Error("Tab timeout"));
      }, 30000);

      function listener(id: number, info: any) {
        if (id === tabId && info.status === "complete") {
          clearTimeout(timeout);
          chrome.tabs.onUpdated.removeListener(listener);
          chrome.tabs.get(tabId).then(resolve);
        }
      }
      chrome.tabs.onUpdated.addListener(listener);
    });
  }

  private isNewChatUrl(url: string): boolean {
    try {
      const urlObj = new URL(url);
      const host = urlObj.hostname;
      const path = urlObj.pathname;

      if (host.includes("chatgpt.com") || host.includes("chat.openai.com")) {
        return (
          path === "/" || path === "" || path === "/?" || this.isAuthUrl(url)
        );
      }
      if (host.includes("gemini.google.com")) {
        const normalizedPath = path.replace(/\/$/, "");
        return (
          normalizedPath === "/app" ||
          normalizedPath.endsWith("/app") ||
          normalizedPath === "/u/0/app" ||
          normalizedPath === "/u/1/app" ||
          this.isAuthUrl(url)
        );
      }
      if (host.includes("claude.ai")) {
        return (
          path === "/new" ||
          path === "/chat" ||
          path === "/" ||
          path === "/chat/" ||
          this.isAuthUrl(url)
        );
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  private isAuthUrl(url: string): boolean {
    const lowerUrl = url.toLowerCase();
    return (
      lowerUrl.includes("/auth") ||
      lowerUrl.includes("/login") ||
      lowerUrl.includes("/sign-in") ||
      lowerUrl.includes("accounts.google.com")
    );
  }
}
