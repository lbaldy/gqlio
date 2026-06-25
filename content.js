// Inject the page-level fetch/XHR interceptor into the main world.
const script = document.createElement('script');
script.src = chrome.runtime.getURL('injected.js');
document.documentElement.appendChild(script);
script.remove();

// Push stored overrides into the page on first load.
chrome.storage.local.get('gqlOverrides', (result) => {
  window.postMessage({ type: 'GQL_UPDATE_OVERRIDES', overrides: result.gqlOverrides || {} }, '*');
});

// Receive override updates from the DevTools panel (relayed via background).
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'GQL_SET_OVERRIDES') {
    window.postMessage({ type: 'GQL_UPDATE_OVERRIDES', overrides: message.overrides }, '*');
  }
});
