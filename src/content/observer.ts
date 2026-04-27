import type { PlatformAdapter } from './adapter';

export const waitForCompletion = (adapter: PlatformAdapter): Promise<void> => {
  return new Promise((resolve) => {
    let checkInterval: any;
    let observer: MutationObserver;
    
    const cleanup = () => {
      if (checkInterval) clearInterval(checkInterval);
      if (observer) observer.disconnect();
    };

    const check = () => {
      if (!adapter.isGenerating()) {
        // Small stability delay to ensure UI has settled
        setTimeout(() => {
           if (!adapter.isGenerating()) {
             cleanup();
             resolve();
           }
        }, 2000);
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
