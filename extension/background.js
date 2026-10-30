"use strict";

const newTabURL = browser.runtime.getURL("newtab.html");
const optionsURL = browser.runtime.getURL("options.html");
const sessions = new Map();
let registration = null;
let configuredURL = null;
let queue = Promise.resolve();

function serial(action) {
  const result = queue.then(action);
  queue = result.catch(() => {});
  return result;
}

function tell(session, message) {
  try { session.port.postMessage(message); } catch (_) { /* The tab closed. */ }
}

async function hasSiteAccess(url) {
  return browser.permissions.contains({ origins: [ClearTab.permissionPattern(url)] });
}

async function setConfiguration(rawURL, persist) {
  const url = ClearTab.normalizeWebsite(rawURL);
  if (!(await hasSiteAccess(url))) throw new Error("Allow access to your chosen website first.");
  const next = await browser.contentScripts.register({
    matches: [ClearTab.permissionPattern(url)],
    js: [{ file: "shared.js" }, { file: "page-bridge.js" }],
    allFrames: true,
    runAt: "document_start"
  });
  try {
    if (persist) await browser.storage.local.set({ websiteURL: url });
  } catch (error) {
    await next.unregister();
    throw error;
  }
  const previous = registration;
  registration = next;
  configuredURL = url;
  if (previous) await previous.unregister().catch(() => {});
  for (const session of sessions.values()) tell(session, { type: "configuration-changed" });
  return { ok: true, url };
}

const ready = serial(async () => {
  const { websiteURL } = await browser.storage.local.get("websiteURL");
  if (websiteURL && await hasSiteAccess(websiteURL)) await setConfiguration(websiteURL, false);
}).catch(error => console.error("Tab & Type could not start:", error.message));

browser.runtime.onConnect.addListener(port => {
  // Web content cannot impersonate the extension's own new-tab document.
  if (port.name !== "clear-new-tab" || port.sender?.url !== newTabURL) return;
  let ownedSession = null;
  let disconnected = false;
  port.onDisconnect.addListener(() => {
    disconnected = true;
    if (ownedSession && sessions.get(ownedSession.tabId) === ownedSession) {
      sessions.delete(ownedSession.tabId);
    }
  });
  port.onMessage.addListener(message => {
    if (message?.type !== "start" || !Number.isInteger(message.tabId) || message.tabId < 0) return;
    void (async () => {
      await ready;
      await queue;
      if (disconnected) return;
      if (Number.isInteger(port.sender.tab?.id) && port.sender.tab.id !== message.tabId) return;
      if (!configuredURL || !(await hasSiteAccess(configuredURL))) {
        port.postMessage({ type: "setup-needed" });
        return;
      }
      if (ownedSession && sessions.get(ownedSession.tabId) === ownedSession) {
        sessions.delete(ownedSession.tabId);
      }
      ownedSession = {
        tabId: message.tabId,
        port,
        url: configuredURL,
        origin: new URL(configuredURL).origin,
        token: crypto.randomUUID(),
        frameId: null,
        opening: false
      };
      sessions.set(message.tabId, ownedSession);
      port.postMessage({ type: "show-page", url: ownedSession.url });
    })().catch(error => {
      try { port.postMessage({ type: "error", message: error.message }); } catch (_) {}
    });
  });
});

browser.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === "configure" && sender.url === optionsURL) {
    return serial(() => setConfiguration(message.url, true));
  }
  if (message?.type === "configuration" && sender.url === optionsURL) {
    return ready.then(() => ({ url: configuredURL }));
  }
  if (!["bridge-ready", "open-link"].includes(message?.type)) return undefined;
  return (async () => {
    const session = sessions.get(sender.tab?.id);
    if (!session || !Number.isInteger(sender.frameId) || sender.frameId <= 0) return { ok: false };
    let source;
    try { source = new URL(sender.url); } catch (_) { return { ok: false }; }
    if (source.origin !== session.origin || !(await hasSiteAccess(session.url))) return { ok: false };
    if (sessions.get(session.tabId) !== session) return { ok: false };

    if (message.type === "bridge-ready") {
      if (session.frameId !== null && session.frameId !== sender.frameId) return { ok: false };
      session.frameId = sender.frameId;
      tell(session, { type: "page-ready" });
      return { ok: true, token: session.token };
    }
    if (sender.frameId !== session.frameId || message.token !== session.token || session.opening) {
      return { ok: false };
    }
    let href;
    try { href = ClearTab.normalizeWebsite(message.href); } catch (_) { return { ok: false }; }
    // A link supplies an absolute URL; never interpret a message as a search.
    if (href !== message.href) return { ok: false };
    session.opening = true;
    try {
      // tabs.update needs no all-tabs or destination-host permission to navigate.
      await browser.tabs.update(session.tabId, { url: href });
      return { ok: true };
    } catch (error) {
      session.opening = false;
      tell(session, { type: "link-error", url: href });
      return { ok: false };
    }
  })();
});

browser.permissions.onRemoved.addListener(() => {
  void serial(async () => {
    if (configuredURL && !(await hasSiteAccess(configuredURL))) {
      if (registration) await registration.unregister().catch(() => {});
      registration = null;
      configuredURL = null;
      for (const session of sessions.values()) tell(session, { type: "setup-needed" });
      sessions.clear();
    }
  });
});

browser.browserAction.onClicked.addListener(() => browser.runtime.openOptionsPage());
