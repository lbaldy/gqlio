// Keeps the MV3 service worker alive while DevTools is open (long-lived port).
// On disconnect (DevTools closed): clears both storage and the live page.

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'gql-panel') return;

  let tabId = null;

  port.onMessage.addListener((msg) => {
    if (msg.type === 'GQL_PANEL_INIT') tabId = msg.tabId;
  });

  port.onDisconnect.addListener(() => {
    if (tabId === null) return;

    // Clear the active-overrides storage key so the next page load (handled by
    // content.js) does not re-activate overrides after DevTools is closed.
    chrome.storage.local.set({ gqlActiveOverrides: [] });

    // Also wipe the live page's override map for the current load.
    chrome.scripting.executeScript({
      target: { tabId },
      world:  'MAIN',
      func:   () => { if (typeof window.__gqlOverrides !== 'undefined') window.__gqlOverrides = []; },
    }).catch(() => {});
  });
});
