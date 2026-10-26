// Ilse for Chrome: click the toolbar icon on a localhost page to put the Ilse
// toolbar on that site — your usual address, no proxy, nothing in the project.
// The choice is kept per origin and the toolbar comes back on every reload.

import { isLocalPage, originOf, toggleOrigin, fetchToolbar, menuItems, menuAction } from './lib.js';

async function enabledOrigins() {
  return (await chrome.storage.local.get('origins')).origins ?? [];
}

// Runs in the page itself (MAIN world): the toolbar reads the page's React
// fibers to find components. An inline script, so there is no request for a
// service worker to drop.
function mountToolbar(code) {
  if (window.__ilseToolbar) return;
  const s = document.createElement('script');
  s.textContent = code;
  (document.head || document.documentElement).appendChild(s);
  s.remove();
}

async function inject(tabId) {
  const code = await fetchToolbar(fetch);
  if (!code) {
    await chrome.action.setBadgeText({ tabId, text: '!' });
    await chrome.action.setTitle({ tabId, title: chrome.i18n.getMessage('notRunning') });
    return;
  }
  await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: mountToolbar, args: [code] });
}

async function refresh(tab) {
  if (!tab.id) return;
  if (!isLocalPage(tab.url)) {
    await chrome.action.setBadgeText({ tabId: tab.id, text: '' });
    await chrome.action.setTitle({ tabId: tab.id, title: chrome.i18n.getMessage('onlyLocal') });
    return;
  }
  const on = (await enabledOrigins()).includes(originOf(tab.url));
  await chrome.action.setBadgeText({ tabId: tab.id, text: on ? 'ON' : '' });
  await chrome.action.setTitle({ tabId: tab.id, title: chrome.i18n.getMessage(on ? 'actionOn' : 'actionOff') });
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !isLocalPage(tab.url)) return;
  const origin = originOf(tab.url);
  const origins = toggleOrigin(await enabledOrigins(), origin);
  await chrome.storage.local.set({ origins });
  await refresh(tab);
  // Off: a reload takes the toolbar away cleanly
  if (origins.includes(origin)) await inject(tab.id);
  else await chrome.tabs.reload(tab.id);
});

chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status !== 'complete') return;
  await refresh(tab);
  if (isLocalPage(tab.url) && (await enabledOrigins()).includes(originOf(tab.url))) await inject(tabId);
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  await refresh(await chrome.tabs.get(tabId));
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.action.setBadgeBackgroundColor({ color: '#FA6900' });
  chrome.contextMenus.removeAll(() => {
    for (const item of menuItems((key) => chrome.i18n.getMessage(key))) chrome.contextMenus.create(item);
  });
});

// Runs in the page (MAIN world): tells the toolbar what to do. A flag too, for a
// toolbar that is still mounting and hasn't heard the event.
function askToolbar(action) {
  window.__ilseContext = action;
  window.dispatchEvent(new CustomEvent('ilse:context', { detail: { action } }));
}

// Right-click → "Open with Ilse". context.js marked the element
// that was right-clicked; the toolbar opens with the card on it.
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const action = menuAction(info.menuItemId);
  if (!action || !tab?.id || !isLocalPage(tab.url)) return;
  // Asking for Ilse on a site turns it on there, like the toolbar icon
  const origin = originOf(tab.url);
  const origins = await enabledOrigins();
  if (!origins.includes(origin)) await chrome.storage.local.set({ origins: [...origins, origin] });
  await refresh(tab);
  await inject(tab.id);
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: askToolbar, args: [action] });
});
