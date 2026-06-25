// Inject the page-level fetch/XHR interceptor into the main world.
// Push saved overrides in the onload callback so the listener in injected.js
// is guaranteed to exist before the postMessage fires.
const script = document.createElement('script');
script.src = chrome.runtime.getURL('injected.js');
script.onload = () => {
  script.remove();
  chrome.storage.local.get('gqlOverrides', (result) => {
    window.postMessage({ type: 'GQL_UPDATE_OVERRIDES', overrides: result.gqlOverrides || {} }, '*');
  });
};
document.documentElement.appendChild(script);

// Receive override updates from the DevTools panel (relayed via background).
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'GQL_SET_OVERRIDES') {
    window.postMessage({ type: 'GQL_UPDATE_OVERRIDES', overrides: message.overrides }, '*');
  }
});
