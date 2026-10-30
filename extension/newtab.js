"use strict";

const website = document.getElementById("website");
const notice = document.getElementById("notice");
const normalLink = document.getElementById("open-normally");
let port;
let currentURL = null;
let waiting = null;
let connected = false;
let tabId;

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
  website.hidden = true;
  website.removeAttribute("src");
  showNotice("Choose your new tab page", "Set a website, then open a new tab. You can type in the address bar right away.");
}

function start() {
  port.postMessage({ type: "start", tabId });
}

async function connect() {
  ({ id: tabId } = await browser.tabs.getCurrent());
  port = browser.runtime.connect({ name: "clear-new-tab" });
  port.onMessage.addListener(message => {
    if (message.type === "show-page") {
      clearTimeout(waiting);
      document.getElementById("link-error").hidden = true;
      connected = false;
      currentURL = message.url;
      notice.hidden = true;
      website.hidden = false;
      // Setting src does not navigate the tab's own extension document, so
      // Firefox leaves the new-tab address bar empty. Never call focus().
      website.src = message.url;
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
  port.onDisconnect.addListener(() => {
    clearTimeout(waiting);
    showNotice("The add-on was restarted", "Open a fresh new tab to reconnect your page.");
  });
  start();
}

document.getElementById("choose").addEventListener("click", () => browser.runtime.openOptionsPage());
document.getElementById("settings").addEventListener("click", () => browser.runtime.openOptionsPage());
void connect().catch(error => showNotice("Couldn’t start Tab & Type", error.message));
