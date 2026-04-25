import type { PlatformAdapter } from './adapter';

export const waitForCompletion = (adapter: PlatformAdapter, timeout = 120000): Promise<void> => {
  return new Promise((resolve, reject) => {
    let checkInterval: any;
    let observer: MutationObserver;
    
    const cleanup = () => {
      if (checkInterval) clearInterval(checkInterval);
      if (observer) observer.disconnect();
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timeout waiting for completion'));
    }, timeout);

    const check = () => {
      if (!adapter.isGenerating()) {
        cleanup();
        clearTimeout(timer);
        resolve();
      }
    };

    // Use MutationObserver for efficiency
    observer = new MutationObserver(() => {
      check();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true
    });

    // Also check every second as a fallback
    checkInterval = setInterval(check, 1000);
  });
};
