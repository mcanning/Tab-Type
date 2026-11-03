"use strict";

// These tests execute the packaged scripts with mocked Firefox APIs and DOM
// events. They do not substitute for an installation test in real Firefox.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { randomUUID } = require("node:crypto");
const root = path.join(__dirname, "..", "extension");
const source = file => fs.readFileSync(path.join(root, file), "utf8");
const copy = value => JSON.parse(JSON.stringify(value));
const flush = () => new Promise(resolve => setImmediate(resolve));

function eventChannel() {
  const listeners = [];
  return { listeners, addListener: fn => listeners.push(fn), emit: (...args) => listeners.map(fn => fn(...args)) };
}

function run(context, file) {
  vm.runInContext(source(file), context, { filename: file });
}

async function background({ stored = "https://www.mlb.com/", allowed = ["https://www.mlb.com/*"] } = {}) {
  const grants = new Set(allowed);
  const registrations = [];
  const navigations = [];
  const failures = { storage: false, register: false, navigate: false };
  const storage = { websiteURL: stored };
  const ownURL = file => `moz-extension://test-addon/${file}`;
  const browser = {
    runtime: { getURL: ownURL, onConnect: eventChannel(), onMessage: eventChannel(), openOptionsPage: async () => {} },
    storage: { local: {
      get: async () => ({ ...storage }),
      set: async value => { if (failures.storage) throw new Error("storage failed"); Object.assign(storage, value); }
    } },
    permissions: {
      contains: async ({ origins }) => origins.every(origin => grants.has(origin)),
      onRemoved: eventChannel()
    },
    contentScripts: { register: async config => {
      if (failures.register) throw new Error("registration failed");
      const registration = { config: copy(config), active: true };
      registrations.push(registration);
      return { unregister: async () => { registration.active = false; } };
    } },
    tabs: { onRemoved: eventChannel(), sendMessage: async () => {}, update: async (id, data) => {
      if (failures.navigate) throw new Error("navigation failed");
      navigations.push({ id, ...copy(data) });
      return { id };
    } },
    browserAction: { onClicked: eventChannel() }
  };
  const context = vm.createContext({ browser, URL, crypto: { randomUUID }, console });
  run(context, "shared.js");
  run(context, "background.js");
  const send = (message, sender = { url: ownURL("options.html") }) =>
    browser.runtime.onMessage.listeners[0](message, sender);
  await send({ type: "configuration" });
  async function connect(id = 7, sender = { url: ownURL("newtab.html"), tab: { id } }, resume = false) {
    const messages = [];
    const port = { name: "clear-new-tab", sender, onMessage: eventChannel(), onDisconnect: eventChannel(), postMessage: msg => messages.push(copy(msg)) };
    browser.runtime.onConnect.emit(port);
    port.onMessage.emit({ type: "start", tabId: id, resume });
    await flush();
    return { port, messages };
  }
  const pageSender = (overrides = {}) => ({ url: "https://www.mlb.com/", tab: { id: 7 }, frameId: 2, ...overrides });
  return { browser, send, connect, pageSender, navigations, registrations, storage, grants, failures, ownURL };
}

function element(localName, attrs = {}) {
  const attributes = { ...attrs };
  return {
    nodeType: 1, localName, attributes,
    hasAttribute: name => Object.hasOwn(attributes, name),
    matches: selector => selector === "button.widget-group-title-current[data-title-url]" &&
      localName === "button" && (attributes.class || "").split(/\s+/).includes("widget-group-title-current") && Object.hasOwn(attributes, "data-title-url"),
    getAttribute: name => attributes[name] ?? null,
    setAttribute: (name, value) => { attributes[name] = value; }
  };
}

async function bridge({ mode = "iframe", authorized = true, baseTarget = null, baseURI = "https://www.mlb.com/", sendResult = { ok: true } } = {}) {
  const listeners = {};
  const messages = [];
  const top = {};
  const window = { top, parent: top, addEventListener: (type, callback, capture) => {
    if (type !== "click" || capture) listeners[type] = callback;
  } };
  if (mode === "top") window.top = window.parent = window;
  if (mode === "nested") window.parent = {};
  const document = { baseURI, querySelector: () => baseTarget === null ? null : element("base", { target: baseTarget }) };
  const browser = { runtime: { id: "test-addon", onMessage: eventChannel(), sendMessage: async message => {
    messages.push(copy(message));
    return message.type === "bridge-ready" ? { ok: authorized, token: "test-token" } : sendResult;
  } } };
  const view = { page: "https://www.mlb.com/", x: 0, y: 700, groups: [], scroll: [] };
  const timers = new Map();
  let nextTimer = 0;
  const context = vm.createContext({ window, document, location: { href: "https://www.mlb.com/" }, browser, URL,
    ClearTabView: { capture: () => view, restore: (_, done) => { done(); return () => {}; } },
    setTimeout: fn => { timers.set(++nextTimer, fn); return nextTimer; }, clearTimeout: id => timers.delete(id) });
  run(context, "shared.js");
  run(context, "page-bridge.js");
  await flush();
  function click(attrs = { href: "/news" }, overrides = {}) {
    const anchor = element("a", attrs);
    const event = {
      isTrusted: true, button: 0, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false,
      prevented: false, stopped: false,
      composedPath: () => [element("svg"), anchor, window],
      preventDefault() { this.prevented = true; },
      stopImmediatePropagation() { this.stopped = true; },
      ...overrides
    };
    listeners.click?.(event);
    return event;
  }
  return { listeners, messages, click, browser, view, timers };
}

test("website input accepts ordinary URLs and rejects privileged URLs and credentials", () => {
  const context = vm.createContext({ URL });
  run(context, "shared.js");
  const api = context.ClearTab;
  assert.equal(api.normalizeWebsite("  mlb.com  "), "https://mlb.com/");
  assert.equal(api.normalizeWebsite("https://www.mlb.com/news?q=a#latest"), "https://www.mlb.com/news?q=a#latest");
  assert.equal(api.permissionPattern("https://example.com:8443/a"), "https://example.com/*");
  for (const value of ["", "javascript:alert(1)", "data:text/html,test", "file:///a", "about:config", "https://user:pass@example.com/", null]) {
    assert.throws(() => api.normalizeWebsite(value), undefined, String(value));
  }
});

test("first use without a saved site needs setup and registers no site script", async () => {
  const bg = await background({ stored: null, allowed: [] });
  const session = await bg.connect();
  assert.equal(bg.registrations.length, 0);
  assert.deepEqual(session.messages, [{ type: "setup-needed" }]);
});

test("saved website starts an authorized new-tab session with a site-specific script", async () => {
  const bg = await background();
  const { messages } = await bg.connect();
  assert.deepEqual(bg.registrations[0].config.matches, ["https://www.mlb.com/*"]);
  assert.deepEqual(messages, [{ type: "show-page", url: "https://www.mlb.com/" }]);
  const response = await bg.send({ type: "bridge-ready" }, bg.pageSender());
  assert.equal(response.ok, true);
  assert.ok(response.token);
  assert.equal(messages.at(-1).type, "page-ready");
});

test("ordinary web pages cannot impersonate a new-tab session", async () => {
  const bg = await background();
  const session = await bg.connect(7, { url: "https://www.mlb.com/", tab: { id: 7 } });
  assert.equal(session.messages.length, 0);
  assert.equal((await bg.send({ type: "bridge-ready" }, bg.pageSender())).ok, false);
});

test("port ownership rejects a different tab ID", async () => {
  const bg = await background();
  const session = await bg.connect(7, { url: bg.ownURL("newtab.html"), tab: { id: 8 } });
  assert.equal(session.messages.length, 0);
});

test("only the authenticated frame and token may navigate its own tab", async () => {
  const bg = await background();
  await bg.connect();
  for (const sender of [bg.pageSender({ frameId: 0 }), bg.pageSender({ tab: { id: 99 } }), bg.pageSender({ url: "https://evil.example/" }), bg.pageSender({ url: "https://www.mlb.com:8443/" })]) {
    assert.equal((await bg.send({ type: "bridge-ready" }, sender)).ok, false);
  }
  const { token } = await bg.send({ type: "bridge-ready" }, bg.pageSender());
  assert.equal((await bg.send({ type: "bridge-ready" }, bg.pageSender({ frameId: 3 }))).ok, false);
  const link = { type: "open-link", token, href: "https://news.ycombinator.com/" };
  assert.equal((await bg.send({ ...link, token: "wrong" }, bg.pageSender())).ok, false);
  assert.equal((await bg.send(link, bg.pageSender({ frameId: 3 }))).ok, false);
  for (const href of ["javascript:alert(1)", "file:///a", "example.com", "https://user:pass@example.com/"]) {
    assert.equal((await bg.send({ ...link, href }, bg.pageSender())).ok, false);
  }
  assert.equal(bg.navigations.length, 0);
  assert.equal((await bg.send(link, bg.pageSender())).ok, true);
  assert.deepEqual(bg.navigations, [{ id: 7, url: "https://news.ycombinator.com/" }]);
  assert.equal((await bg.send(link, bg.pageSender())).ok, false);
});

test("a failed navigation produces a visible retry and permits another attempt", async () => {
  const bg = await background();
  const { messages } = await bg.connect();
  const { token } = await bg.send({ type: "bridge-ready" }, bg.pageSender());
  const link = { type: "open-link", token, href: "https://example.com/" };
  bg.failures.navigate = true;
  assert.equal((await bg.send(link, bg.pageSender())).ok, false);
  assert.deepEqual(messages.at(-1), { type: "link-error", url: link.href });
  bg.failures.navigate = false;
  assert.equal((await bg.send(link, bg.pageSender())).ok, true);
});

test("closing a new-tab document invalidates its bridge", async () => {
  const bg = await background();
  const { port } = await bg.connect();
  const { token } = await bg.send({ type: "bridge-ready" }, bg.pageSender());
  port.onDisconnect.emit();
  assert.equal((await bg.send({ type: "open-link", token, href: "https://example.com/" }, bg.pageSender())).ok, false);
  assert.equal(bg.navigations.length, 0);
});

test("settings require a grant and save atomically when registration or storage fails", async () => {
  const bg = await background();
  const config = { type: "configure", url: "https://example.com/" };
  assert.equal(bg.send(config, { url: "https://www.mlb.com/" }), undefined);
  await assert.rejects(bg.send(config), /Allow access/);
  bg.grants.add("https://example.com/*");
  bg.failures.register = true;
  await assert.rejects(bg.send(config), /registration failed/);
  bg.failures.register = false;
  bg.failures.storage = true;
  await assert.rejects(bg.send(config), /storage failed/);
  assert.equal(bg.registrations[0].active, true);
  assert.equal(bg.registrations[1].active, false);
  assert.equal((await bg.send({ type: "configuration" })).url, "https://www.mlb.com/");
  bg.failures.storage = false;
  assert.equal((await bg.send(config)).ok, true);
  assert.equal(bg.storage.websiteURL, config.url);
  assert.equal(bg.registrations[0].active, false);
  assert.equal(bg.registrations.at(-1).active, true);
});

test("revoking site access immediately disables navigation and clears the page", async () => {
  const bg = await background();
  const { messages } = await bg.connect();
  const { token } = await bg.send({ type: "bridge-ready" }, bg.pageSender());
  bg.grants.clear();
  assert.equal((await bg.send({ type: "open-link", token, href: "https://example.com/" }, bg.pageSender())).ok, false);
  bg.browser.permissions.onRemoved.emit();
  await flush();
  assert.equal(messages.at(-1).type, "setup-needed");
  assert.equal(bg.registrations[0].active, false);
});

test("a real ordinary link, including a click on its SVG child, opens in the full tab", async () => {
  const br = await bridge();
  const click = br.click({ href: "https://news.ycombinator.com/" });
  assert.equal(click.prevented, true);
  assert.equal(click.stopped, true);
  assert.deepEqual(br.messages.at(-1), { type: "open-link", href: "https://news.ycombinator.com/", token: "test-token", view: br.view });
});

test("relative links resolve against the document base and work without pre-scanning anchors", async () => {
  const br = await bridge({ baseURI: "https://www.mlb.com/stories/" });
  br.click({ href: "today" });
  assert.equal(br.messages.at(-1).href, "https://www.mlb.com/stories/today");
});

test("modified clicks, downloads, fragment links and special URLs retain native behavior", async () => {
  const cases = [
    [{ href: "/news" }, { ctrlKey: true }], [{ href: "/news" }, { metaKey: true }],
    [{ href: "/news" }, { shiftKey: true }], [{ href: "/news" }, { altKey: true }],
    [{ href: "/news" }, { button: 1 }], [{ href: "/news" }, { isTrusted: false }],
    [{ href: "/file", download: "" }],
    [{ href: "#scores" }], [{ href: "https://www.mlb.com/#scores" }],
    [{ href: "mailto:a@example.com" }], [{ href: "javascript:void(0)" }],
    [{ href: "https://user:pass@example.com/" }]
  ];
  for (const [attrs, overrides] of cases) {
    const br = await bridge();
    assert.equal(br.click(attrs, overrides).prevented, false, JSON.stringify([attrs, overrides]));
    assert.equal(br.messages.length, 1);
  }
});

test("Glance links initially marked _blank are handled before its script can change them to _self", async () => {
  const br = await bridge();
  const event = br.click({ href: "https://news.ycombinator.com/", target: "_blank" });
  assert.equal(event.prevented, true);
  assert.equal(event.stopped, true);
  assert.equal(br.messages.at(-1).href, "https://news.ycombinator.com/");
  const inherited = await bridge({ baseTarget: "_blank" });
  assert.equal(inherited.click({ href: "/news" }).prevented, true);
});

test("Glance active group-heading buttons navigate fully, while inactive headings still switch groups", async () => {
  const br = await bridge();
  const heading = element("button", { class: "widget-group-title widget-group-title-current", "data-title-url": "https://news.ycombinator.com/" });
  const event = br.click({}, { composedPath: () => [element("span"), heading] });
  assert.equal(event.prevented, true);
  assert.equal(event.stopped, true);
  assert.equal(br.messages.at(-1).href, "https://news.ycombinator.com/");
  const inactive = element("button", { class: "widget-group-title", "data-title-url": "https://news.ycombinator.com/" });
  assert.equal(br.click({}, { composedPath: () => [inactive] }).prevented, false);
});

test("normal visits, nested frames and unauthorized frames do not change links", async () => {
  for (const mode of ["top", "nested"]) {
    const br = await bridge({ mode });
    assert.equal(br.messages.length, 0);
    assert.equal(Object.keys(br.listeners).length, 0);
  }
  const br = await bridge({ authorized: false });
  assert.equal(br.click().prevented, false);
  assert.equal(br.messages.length, 1);
});

test("native forms are targeted to the full tab without changing method or body", async () => {
  const br = await bridge();
  const form = element("form", { method: "post", action: "https://example.com/search", enctype: "multipart/form-data" });
  const submitter = element("button", { formtarget: "_self", name: "go", value: "Search" });
  br.listeners.submit({ isTrusted: true, target: form, submitter });
  assert.deepEqual(form.attributes, { method: "post", action: "https://example.com/search", enctype: "multipart/form-data", target: "_top" });
  assert.deepEqual(submitter.attributes, { formtarget: "_top", name: "go", value: "Search" });
  assert.equal(br.messages.length, 2);
  assert.equal(br.messages.at(-1).type, "save-view");
  const blank = element("form", { target: "_blank" });
  br.listeners.submit({ isTrusted: true, target: blank });
  assert.equal(blank.getAttribute("target"), "_blank");
  const synthetic = element("form", {});
  br.listeners.submit({ isTrusted: false, target: synthetic });
  assert.equal(synthetic.getAttribute("target"), null);
});

test("quick double-clicks navigate once, and rejected requests can be retried", async () => {
  const br = await bridge();
  br.click(); br.click();
  assert.equal(br.messages.length, 2);
  const failed = await bridge({ sendResult: { ok: false } });
  failed.click();
  await flush();
  failed.click();
  assert.equal(failed.messages.length, 3);
});

test("all packaged JavaScript parses and manifest entry points exist", () => {
  for (const file of fs.readdirSync(root).filter(file => file.endsWith(".js"))) {
    assert.doesNotThrow(() => new vm.Script(source(file), { filename: file }));
  }
  const manifest = JSON.parse(source("manifest.json"));
  for (const file of [...manifest.background.scripts, manifest.options_ui.page, manifest.chrome_url_overrides.newtab, ...Object.values(manifest.icons)]) {
    assert.ok(fs.existsSync(path.join(root, file)), file);
  }
  assert.deepEqual(manifest.permissions, ["storage"]);
  assert.deepEqual(manifest.browser_specific_settings.gecko.data_collection_permissions.required, ["none"]);
});

test("Back restores only that tab's saved dashboard view and renews bridge authorization", async () => {
  const bg = await background();
  const original = await bg.connect();
  const { token } = await bg.send({ type: "bridge-ready" }, bg.pageSender());
  const view = { page: "https://www.mlb.com/", x: 0, y: 900,
    groups: [{ path: [1, 2], selected: 2 }], expansions: [{ path: [1, 2, 1], expanded: true }],
    scroll: [{ path: [1, 4], x: 120, y: 70 }] };
  assert.equal((await bg.send({ type: "open-link", token, href: "https://example.com/", view }, bg.pageSender())).ok, true);
  original.port.onDisconnect.emit();
  const restored = await bg.connect(7, undefined, true);
  assert.deepEqual(restored.messages[0], { type: "show-page", url: view.page, resume: true, siteURL: view.page });
  const resumed = await bg.send({ type: "bridge-ready" }, bg.pageSender());
  assert.deepEqual(copy(resumed.view), view);
  assert.notEqual(resumed.token, token);
  assert.equal((await bg.send({ type: "open-link", token, href: "https://example.com/" }, bg.pageSender())).ok, false);
  assert.equal((await bg.send({ type: "bridge-ready" }, bg.pageSender())).view, undefined, "Do not apply an old view twice");
  assert.equal((await bg.send({ type: "open-link", token: resumed.token, href: "https://example.com/" }, bg.pageSender())).ok, true);
  await bg.connect(8, undefined, true);
  assert.equal((await bg.send({ type: "bridge-ready" }, bg.pageSender({ tab: { id: 8 } }))).view, undefined);
});

test("view snapshots require the authenticated frame/token and contain only bounded view state", async () => {
  const bg = await background();
  await bg.connect();
  const { token } = await bg.send({ type: "bridge-ready" }, bg.pageSender());
  const view = { page: "https://www.mlb.com/", y: 700, password: "do not retain", html: "do not retain",
    groups: [{ path: [1], selected: 2 }, { path: [-1], selected: 4 }], scroll: [],
    expansions: [{ path: [1, 2], expanded: true, text: "do not retain" }, { path: [-1], expanded: true },
      { path: [1], expanded: "true" }] };
  for (const [badToken, sender] of [["wrong", bg.pageSender()], [token, bg.pageSender({ frameId: 3 })],
    [token, bg.pageSender({ url: "https://evil.example/" })]]) {
    assert.equal((await bg.send({ type: "save-view", token: badToken, view }, sender)).ok, false);
  }
  assert.equal((await bg.send({ type: "save-view", token, view: { ...view, page: "https://evil.example/" } }, bg.pageSender())).ok, false);
  assert.equal((await bg.send({ type: "save-view", token, view }, bg.pageSender())).ok, true);
  await bg.connect(7, undefined, true);
  const restored = await bg.send({ type: "bridge-ready" }, bg.pageSender());
  assert.deepEqual(copy(restored.view), { page: view.page, x: 0, y: 700, groups: [{ path: [1], selected: 2 }],
    expansions: [{ path: [1, 2], expanded: true }], scroll: [] });
});

test("fresh new tabs, closing a tab, changing the site and revoking access discard saved views", async () => {
  for (const reset of ["fresh", "closed", "configured", "revoked"]) {
    const bg = await background();
    await bg.connect();
    const { token } = await bg.send({ type: "bridge-ready" }, bg.pageSender());
    await bg.send({ type: "save-view", token, view: { page: "https://www.mlb.com/", y: 900 } }, bg.pageSender());
    if (reset === "closed") bg.browser.tabs.onRemoved.emit(7);
    if (reset === "configured") await bg.send({ type: "configure", url: "https://www.mlb.com/" });
    if (reset === "revoked") {
      bg.grants.clear();
      bg.browser.permissions.onRemoved.emit();
      await flush();
      bg.grants.add("https://www.mlb.com/*");
      await bg.send({ type: "configure", url: "https://www.mlb.com/" });
    }
    await bg.connect(7, undefined, reset !== "fresh");
    assert.equal((await bg.send({ type: "bridge-ready" }, bg.pageSender())).view, undefined, reset);
  }
});

test("a cached frame can follow links again after Back", async () => {
  const br = await bridge();
  br.click();
  br.listeners.pagehide({ persisted: true });
  assert.equal(br.click().prevented, false, "Hidden frames must lose authorization");
  br.listeners.pageshow({ persisted: true });
  await flush();
  assert.equal(br.click().prevented, true);
  assert.equal(br.messages.filter(message => message.type === "open-link").length, 2);
});
