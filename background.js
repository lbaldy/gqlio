// Relay messages from the DevTools panel to the inspected tab's content script.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GQL_RELAY') {
    chrome.tabs.sendMessage(message.tabId, message.payload).catch(() => {});
  }
});
