import { QueueManager } from "./queueManager";
import { ensureNotionTab, injectNotionScript } from "./notionTab";
import { sendMessageToTab } from "../utils/messaging";


export class Worker {
  private queueManager: QueueManager;
  // Tracks which projects currently have an active processing loop.
  private processingProjects = new Set<string>();
  // Dedicated tab per project — each project owns its own browser tab so
  // multiple projects on the same platform can run in parallel.
  private projectTabMap = new Map<string, number>();
  // Serializes all Notion paste operations across parallel projects.
  // The OS clipboard and the shared Notion tab are both global resources —
  // two concurrent pastes would race and the wrong image lands on the wrong page.
  private notionPasteMutex: Promise<void> = Promise.resolve();

  constructor(queueManager: QueueManager) {
    this.queueManager = queueManager;
  }

  async start() {
    await this.queueManager.ready();
    const { projects } = this.queueManager.getState();
    for (const project of projects) {
      if (project.isRunning && !project.isPaused && !this.processingProjects.has(project.id)) {
        this.processProjectQueue(project.id);
      }
    }
  }

  private async processProjectQueue(projectId: string) {
    if (this.processingProjects.has(projectId)) return;
    this.processingProjects.add(projectId);

    await this.queueManager.ready();
    console.log(`[Worker] Started queue for project ${projectId}`);

    // A task left as 'running' means the service worker was killed mid-execution.
    // Reset it to 'pending' so this loop retries it rather than skipping it forever.
    const staleTasks = this.queueManager.getState().tasks.filter(
      t => t.projectId === projectId && t.status === 'running'
    );
    for (const t of staleTasks) {
      await this.queueManager.updateTask(t.id, { status: 'pending', statusDetail: 'Retrying after interruption' });
    }

    try {
      while (true) {
        const state = this.queueManager.getState();
        const project = state.projects.find(p => p.id === projectId);
        if (!project?.isRunning || project.isPaused) break;

        const task = state.tasks.find(
          t => t.projectId === projectId && t.status === 'pending'
        );
        if (!task) {
          console.log(`[Worker] No more tasks for project ${projectId}`);
          break;
        }

        await this.executeTask(task, project);
        await new Promise((r) => setTimeout(r, 1500));
      }
    } finally {
      this.processingProjects.delete(projectId);
      this.projectTabMap.delete(projectId);
      console.log(`[Worker] Stopped queue for project ${projectId}`);
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
      const tab = await this.ensureProjectTab(project.id, task.platform, effectiveUrl);
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

      // Does this project need image capture? Decide now so we pass captureImage
      // to EXECUTE_PROMPT — the content script will snapshot the image count
      // atomically before sending the prompt, eliminating any race window.
      const projectForCapture = this.queueManager
        .getState()
        .projects.find((p) => p.id === project.id);
      const needsImage = !!projectForCapture?.notionPageUrl;

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
          payload: { prompt: task.prompt, captureImage: needsImage },
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

        // waitForCompletion runs inside the content script (observer.ts) and
        // resolves only when the platform stops generating. The flat 2s sleep
        // here is just a settle buffer after that signal arrives.
        await new Promise((r) => setTimeout(r, 2000));

        await this.queueManager.updateTask(task.id, {
          status: "done",
          statusDetail: "Completed",
        });

        if (project && (!project.targetUrl || this.isNewChatUrl(project.targetUrl))) {
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

        // If an image was captured inline with EXECUTE_PROMPT, paste it to Notion.
        // response.imageDataUrl / response.imageSrc are set by the content script
        // only when captureImage=true was passed — guaranteed to be this prompt's image.
        const freshProject = this.queueManager
          .getState()
          .projects.find((p) => p.id === project.id);
        if (freshProject?.notionPageUrl && (response.imageDataUrl || response.imageSrc)) {
          await this.queueManager.updateTask(task.id, {
            statusDetail: "Pasting image to Notion...",
          });
          const notionResult = await this.withNotionMutex(() =>
            this.pasteImageToNotion(
              response.imageDataUrl,
              response.imageSrc,
              task.prompt,
              freshProject.notionPageUrl!,
            )
          );
          await this.queueManager.updateTask(task.id, {
            statusDetail: notionResult.success
              ? "Completed + Notion updated"
              : `Completed (Notion: ${notionResult.error ?? 'paste failed'})`,
          });
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

  private withNotionMutex<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.notionPasteMutex.then(() => fn());
    this.notionPasteMutex = next.then(() => {}, () => {});
    return next;
  }

  // Encode the image (already captured in the content script) and paste it into
  // the correct Notion page. imageDataUrl/imageSrc come directly from the
  // EXECUTE_PROMPT response — they are already bound to this specific prompt.
  private async pasteImageToNotion(
    imageDataUrl: string | undefined,
    imageSrc: string | undefined,
    prompt: string,
    notionPageUrl: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      if (!imageDataUrl && !imageSrc) {
        return { success: false, error: 'No image data provided' };
      }

      // The Notion content script runs on the notion.so origin and CANNOT fetch
      // a cross-origin CDN URL (CORS). So we must always hand it a self-contained
      // data: URL. If the content script gave us a raw src (cross-origin image like
      // ChatGPT/DALL-E on files.oaiusercontent.com), fetch + encode it HERE, in
      // the background service worker, where host_permissions bypass CORS.
      if (!imageDataUrl && imageSrc) {
        try {
          const res = await fetch(imageSrc);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const blob = await res.blob();
          const arrayBuffer = await blob.arrayBuffer();
          const bytes = new Uint8Array(arrayBuffer);
          // Chunk to avoid stack overflow on large images
          let binary = '';
          const CHUNK = 8192;
          for (let i = 0; i < bytes.length; i += CHUNK) {
            binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
          }
          const base64 = btoa(binary);
          const mime = blob.type || 'image/png';
          imageDataUrl = `data:${mime};base64,${base64}`;
        } catch (fetchErr: any) {
          return { success: false, error: `Could not fetch image: ${fetchErr.message}` };
        }
      }

      // Hard guarantee: never proceed without a data URL the Notion script can
      // use directly. (Covers the case where a same-origin capture returned only
      // a src, or encoding silently produced nothing.)
      if (!imageDataUrl) {
        return { success: false, error: 'Could not produce a usable image (no data URL)' };
      }

      // Find or open the Notion tab (shared with the scan flow — see notionTab.ts).
      const notionTab = await ensureNotionTab(notionPageUrl);
      if (!notionTab?.id) {
        return { success: false, error: 'Could not open Notion tab' };
      }

      // Wait for the Notion page to settle after navigation/focus.
      await new Promise((r) => setTimeout(r, 2000));

      // Inject the notion content script (no-op if already injected; returns an
      // error string only if the tab is gone/inaccessible).
      const injectErr = await injectNotionScript(notionTab.id);
      if (injectErr) {
        return { success: false, error: injectErr };
      }

      // Send ONLY the self-contained data URL — the Notion script must not
      // attempt a cross-origin fetch (it would be CORS-blocked on notion.so).
      const result = await sendMessageToTab(
        notionTab.id,
        {
          type: 'NOTION_PASTE_IMAGE',
          payload: {
            prompt,
            imageDataUrl,
          },
        },
        3,
      ).catch((e: Error) => ({ success: false, error: e.message }));

      if (!result?.success) {
        console.warn('[Worker] Notion paste failed:', result?.error);
        return { success: false, error: result?.error ?? 'Paste failed' };
      }

      console.log('[Worker] Notion paste succeeded');
      return { success: true };
    } catch (err: any) {
      console.error('[Worker] pasteImageToNotion error:', err);
      return { success: false, error: err.message };
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

  private async ensureProjectTab(
    projectId: string,
    platform: string,
    targetUrl?: string,
  ): Promise<chrome.tabs.Tab> {
    const config =
      Worker.PLATFORM_CONFIG[platform] || Worker.PLATFORM_CONFIG.chatgpt;

    // 1. SPECIFIC LOCK: project is pinned to a particular existing chat URL.
    if (targetUrl && !this.isNewChatUrl(targetUrl)) {
      const allTabs = await chrome.tabs.query({});
      const targetBase = targetUrl.split('?')[0].replace(/\/$/, '');

      const matchingTab = allTabs.find(t => {
        if (!t.url) return false;
        const tabBase = t.url.split('?')[0].replace(/\/$/, '');
        return tabBase === targetBase;
      });

      if (matchingTab) {
        this.projectTabMap.set(projectId, matchingTab.id!);
        return this.waitForTabComplete(matchingTab.id!);
      }

      // Lock URL not found — navigate any platform tab not owned by another project, or open a new one.
      // Reserve our slot in the map with a sentinel BEFORE any await so a concurrent
      // coroutine for a different project sees it as owned and won't pick the same tab.
      this.projectTabMap.set(projectId, -1);
      const platformTabsFound = await chrome.tabs.query({ url: config.patterns });
      const ownedTabIds = new Set(this.projectTabMap.values());
      const freeTab = platformTabsFound.find(t => t.id !== undefined && !ownedTabIds.has(t.id!));
      if (freeTab) {
        this.projectTabMap.set(projectId, freeTab.id!);
        await chrome.tabs.update(freeTab.id!, { url: targetUrl });
        return this.waitForTabComplete(freeTab.id!);
      }
      const tab = await chrome.tabs.create({ url: targetUrl, active: false });
      this.projectTabMap.set(projectId, tab.id!);
      return this.waitForTabComplete(tab.id!);
    }

    // 2. NO LOCK — each project gets its own dedicated tab so parallel projects
    //    on the same platform don't share a tab and stomp each other's prompts.
    const existingTabId = this.projectTabMap.get(projectId);
    if (existingTabId !== undefined) {
      try {
        const existing = await chrome.tabs.get(existingTabId);
        const existingUrl = existing?.url ?? '';
        const onCorrectPlatform = config.patterns.some(p => {
          const base = p.replace(/\/?\*$/, '');
          return existingUrl.startsWith(base + '/') || existingUrl === base;
        });
        if (existing && onCorrectPlatform && !this.isAuthUrl(existingUrl)) {
          return this.waitForTabComplete(existingTabId);
        }
      } catch {
        // Tab was closed — fall through to create a new one.
      }
      this.projectTabMap.delete(projectId);
    }

    // Allocate a brand-new background tab for this project.
    const tab = await chrome.tabs.create({ url: config.defaultUrl, active: false });
    this.projectTabMap.set(projectId, tab.id!);
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
