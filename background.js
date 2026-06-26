// tabId → MessagePort for the DevTools panel on that tab.
// Keeping a port open also prevents the MV3 service worker from being suspended.
const panelPorts = new Map();

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'gql-panel') return;

  let tabId = null;

  port.onMessage.addListener((msg) => {
    if (msg.type === 'GQL_PANEL_INIT') {
      tabId = msg.tabId;
      panelPorts.set(tabId, port);
    }
  });

  port.onDisconnect.addListener(() => {
    if (tabId !== null) {
      panelPorts.delete(tabId);
      // DevTools was closed — clear all overrides from the page.
      chrome.tabs.sendMessage(tabId, { type: 'GQL_SET_OVERRIDES', overrides: {} }).catch(() => {});
    }
  });
});

chrome.runtime.onMessage.addListener((message, sender) => {
  // Panel → background → content script relay
  if (message.type === 'GQL_RELAY') {
    chrome.tabs.sendMessage(message.tabId, message.payload).catch(() => {});
    return;
  }

  // Content script signals that a new page context is live and injected.js is ready.
  // Forward to the panel so it can re-push overrides (honouring pause state).
  if (message.type === 'GQL_CONTENT_READY') {
    const port = panelPorts.get(sender.tab?.id);
    if (port) port.postMessage({ type: 'GQL_PAGE_NAVIGATED' });
  }
});
