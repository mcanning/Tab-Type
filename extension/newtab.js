"use strict";

const website = document.getElementById("website");
const notice = document.getElementById("notice");
const normalLink = document.getElementById("open-normally");
let port;
let currentURL = null;
let currentSite = null;
let waiting = null;
let connected = false;
let tabId;
let active = true;
let connecting = false;
let resumeRequested = false;

function showNotice(title, copy) {
  notice.hidden = false;
  document.getElementById("notice-title").textContent = title;
  document.getElementById("notice-copy").textContent = copy;
  normalLink.hidden = !currentURL;
  if (currentURL) normalLink.href = currentURL;
}

function setupNeeded() {
  clearTimeout(waiting);
  document.getElementById("link-error").hidden = true;
  currentURL = null;
  currentSite = null;
  website.hidden = true;
  website.removeAttribute("src");
  showNotice("Choose your new tab page", "Set a website, then open a new tab. You can type in the address bar right away.");
}

function start(resume = false) {
  port.postMessage({ type: "start", tabId, resume });
}

async function connect(resume = false) {
  resumeRequested ||= resume;
  if (!active || connecting || port) return;
  connecting = true;
  try { ({ id: tabId } = await browser.tabs.getCurrent()); }
  finally { connecting = false; }
  if (!active || port) return;
  const connection = browser.runtime.connect({ name: "clear-new-tab" });
  port = connection;
  connection.onMessage.addListener(message => {
    if (!active || port !== connection) return;
    if (message.type === "show-page") {
      clearTimeout(waiting);
      document.getElementById("link-error").hidden = true;
      connected = false;
      const keepFrame = message.resume && website.getAttribute("src") &&
        currentSite === (message.siteURL || message.url);
      currentURL = message.url;
      currentSite = message.siteURL || message.url;
      notice.hidden = true;
      website.hidden = false;
      // Setting src does not navigate the tab's own extension document, so
      // Firefox leaves the new-tab address bar empty. Never call focus().
      if (!keepFrame) website.src = message.url;
      waiting = setTimeout(() => {
        if (!connected) showNotice("This page hasn’t connected", "The site may still be loading, may block embedded pages, or may redirect to another address. You can open it normally or choose its final address in settings.");
      }, 18000);
    } else if (message.type === "page-ready") {
      connected = true;
      clearTimeout(waiting);
      notice.hidden = true;
    } else if (message.type === "setup-needed") {
      setupNeeded();
    } else if (message.type === "configuration-changed") {
      start();
    } else if (message.type === "link-error") {
      document.getElementById("retry-link").href = message.url;
      document.getElementById("link-error").hidden = false;
    } else if (message.type === "error") {
      showNotice("Couldn’t load this page", message.message);
    }
  });
  connection.onDisconnect.addListener(() => {
    if (port !== connection) return;
    port = null;
    clearTimeout(waiting);
    if (active) showNotice("The add-on was restarted", "Open a fresh new tab to reconnect your page.");
  });
  start(resumeRequested);
  resumeRequested = false;
}

window.addEventListener("pagehide", () => {
  active = false;
  clearTimeout(waiting);
  const connection = port;
  port = null;
  connection?.disconnect();
});
window.addEventListener("pageshow", event => {
  active = true;
  if (event.persisted) void connect(true).catch(error => showNotice("Couldn’t restore this page", error.message));
});
document.getElementById("choose").addEventListener("click", () => browser.runtime.openOptionsPage());
document.getElementById("settings").addEventListener("click", () => browser.runtime.openOptionsPage());
const returning = performance.getEntriesByType("navigation")[0]?.type === "back_forward";
void connect(returning).catch(error => showNotice("Couldn’t start Tab & Type", error.message));
