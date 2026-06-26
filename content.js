// Inject the page-level fetch/XHR interceptor into the main world.
const script = document.createElement('script');
script.src = chrome.runtime.getURL('injected.js');
script.onload = () => {
  script.remove();
  // Reliable fallback: push overrides from storage once injected.js is ready.
  // The panel also pushes via inspectedWindow.eval, but that can silently fail
  // when the page context is being rebuilt during navigation. Reading from storage
  // here ensures overrides are always applied, even if eval missed the load.
  chrome.storage.local.get(['gqlOverrides', 'gqlOverridesPaused'], (result) => {
    const overrides = result.gqlOverrides ?? [];
    const paused    = result.gqlOverridesPaused ?? false;
    const toSync    = paused ? [] : (Array.isArray(overrides) ? overrides : []);
    window.postMessage({ type: 'GQL_UPDATE_OVERRIDES', overrides: toSync }, '*');
  });
};
document.documentElement.appendChild(script);
