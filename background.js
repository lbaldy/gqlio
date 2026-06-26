// Keeps the MV3 service worker alive while DevTools is open (long-lived port).
// When the port disconnects (DevTools closed), clear overrides directly in the page.

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'gql-panel') return;

  let tabId = null;

  port.onMessage.addListener((msg) => {
    if (msg.type === 'GQL_PANEL_INIT') tabId = msg.tabId;
  });

  port.onDisconnect.addListener(() => {
    if (tabId === null) return;
    // Wipe overrides in the page's main world so intercepting stops immediately.
    chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => { if (typeof window.__gqlOverrides !== 'undefined') window.__gqlOverrides = {}; },
    }).catch(() => {});
  });
});
