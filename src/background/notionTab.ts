// Shared helpers for opening/focusing the linked Notion tab and injecting the
// Notion content script. Used by both the image-paste flow (worker.ts) and the
// "Scan Visuals" flow (index.ts) so the tab plumbing lives in one place.

function waitForTabComplete(tabId: number): Promise<chrome.tabs.Tab> {
  return chrome.tabs.get(tabId).then((tab) => {
    if (tab.status === 'complete') {
      return new Promise((r) => setTimeout(() => r(tab), 500));
    }
    return new Promise<chrome.tabs.Tab>((resolve, reject) => {
      const timeout = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        reject(new Error('Tab timeout'));
      }, 30000);

      function listener(id: number, info: chrome.tabs.OnUpdatedInfo) {
        if (id === tabId && info.status === 'complete') {
          clearTimeout(timeout);
          chrome.tabs.onUpdated.removeListener(listener);
          chrome.tabs.get(tabId).then(resolve);
        }
      }
      chrome.tabs.onUpdated.addListener(listener);
    });
  });
}

// Find an already-open tab on the linked Notion page, or open one. Returns the
// tab once it has finished loading.
export async function ensureNotionTab(
  notionPageUrl: string,
): Promise<chrome.tabs.Tab | null> {
  const urlBase = notionPageUrl.split('?')[0].replace(/\/$/, '');
  const allTabs = await chrome.tabs.query({});
  const existing = allTabs.find((t) => {
    if (!t.url) return false;
    return t.url.split('?')[0].replace(/\/$/, '') === urlBase;
  });

  if (existing) {
    await chrome.tabs.update(existing.id!, { active: true });
    if (existing.windowId) {
      await chrome.windows.update(existing.windowId, { focused: true });
    }
    return waitForTabComplete(existing.id!);
  }

  const tab = await chrome.tabs.create({ url: notionPageUrl, active: true });
  if (tab.windowId) {
    await chrome.windows.update(tab.windowId, { focused: true });
  }
  return waitForTabComplete(tab.id!);
}

// Inject the Notion content script into the tab. Safe to call on an
// already-injected tab (the script guards against double-registration).
// Returns an error string if the tab is gone/inaccessible, else null.
export async function injectNotionScript(tabId: number): Promise<string | null> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['notion.js'],
    });
    await new Promise((r) => setTimeout(r, 300));
    return null;
  } catch (injectErr: any) {
    const msg = String(injectErr?.message ?? injectErr);
    if (msg.includes('No tab') || msg.includes('Cannot access') || msg.includes('closed')) {
      return `Notion tab unavailable: ${msg}`;
    }
    // Otherwise assume the manifest-declared content script is already live.
    return null;
  }
}
