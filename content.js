// Inject the page-level fetch/XHR interceptor into the main world.
const script = document.createElement('script');
script.src = chrome.runtime.getURL('injected.js');
script.onload = () => {
  script.remove();
  // Signal the panel (via background) that this page context is ready.
  // The panel will call persistAndSync() to push overrides, honouring pause state.
  // Using .catch() because the background may not be alive if DevTools is closed.
  chrome.runtime.sendMessage({ type: 'GQL_CONTENT_READY' }).catch(() => {});
};
document.documentElement.appendChild(script);

// Receive override updates from the DevTools panel (relayed via background).
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'GQL_SET_OVERRIDES') {
    window.postMessage({ type: 'GQL_UPDATE_OVERRIDES', overrides: message.overrides }, '*');
  }
});
