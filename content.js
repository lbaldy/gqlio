// Inject the page-level fetch/XHR interceptor into the main world.
const script = document.createElement('script');
script.src = chrome.runtime.getURL('injected.js');
script.onload = () => {
  script.remove();
  // Push whatever the panel last committed as "active".
  // gqlActiveOverrides is [] whenever DevTools is closed, so this is safe to
  // call unconditionally — no risk of activating overrides when DevTools is shut.
  chrome.storage.local.get('gqlActiveOverrides', (result) => {
    const overrides = result.gqlActiveOverrides;
    window.postMessage({
      type:      'GQL_UPDATE_OVERRIDES',
      overrides: Array.isArray(overrides) ? overrides : [],
    }, '*');
  });
};
document.documentElement.appendChild(script);
