"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.join(__dirname, "..", "extension");
const run = (context, file) => vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context, { filename: file });
const flush = () => new Promise(resolve => setImmediate(resolve));

function events() {
  const listeners = new Map();
  return {
    addEventListener(type, fn) { const list = listeners.get(type) || []; list.push(fn); listeners.set(type, list); },
    removeEventListener(type, fn) { listeners.set(type, (listeners.get(type) || []).filter(f => f !== fn)); },
    emit(type, event = {}) { for (const fn of [...(listeners.get(type) || [])]) fn(event); }
  };
}

function clock() {
  const pending = new Map();
  let next = 0;
  return {
    setTimeout(fn) { pending.set(++next, fn); return next; },
    clearTimeout(id) { pending.delete(id); },
    tick() { const batch = [...pending.values()]; pending.clear(); for (const fn of batch) fn(); },
    count: () => pending.size
  };
}

function node(classes = "", children = []) {
  const names = new Set(classes.split(" ").filter(Boolean));
  const element = {
    children, parentElement: null, scrollLeft: 0, scrollTop: 0,
    classList: { contains: value => names.has(value), add: value => names.add(value), remove: value => names.delete(value) },
    matches(selector) { return selector === "button.widget-group-title" ? names.has("widget-group-title") : names.has(selector.slice(1)); },
    querySelector(selector) { return descendants(this).find(child => child.matches(selector)) || null; },
    scrollTo({ left, top }) { this.scrollLeft = left; this.scrollTop = top; }
  };
  for (const child of children) child.parentElement = element;
  return element;
}
function descendants(element) { return element.children.flatMap(child => [child, ...descendants(child)]); }

function dashboard({ ready = "complete", handlers = true } = {}) {
  const timer = clock();
  const window = { ...events(), scrollX: 0, scrollY: 0, scrollTo({ left, top }) { this.scrollX = left; this.scrollY = top; } };
  const titles = [node("widget-group-title widget-group-title-current"), node("widget-group-title")];
  let enabled = handlers;
  let selection = 0;
  let destinations = 0;
  titles.forEach((title, index) => { title.click = () => {
    if (!enabled) return;
    if (selection === index) { destinations++; return; }
    selection = index;
    titles.forEach((item, n) => n === index ? item.classList.add("widget-group-title-current") : item.classList.remove("widget-group-title-current"));
  }; });
  const group = node("widget-type-group", [node("widget-header", titles)]);
  const pane = node("scrolling-pane");
  const input = node("password-field"); input.value = "do not collect this";
  const html = node("html", [node("head"), node("body", [group, pane, input])]);
  const document = { ...events(), readyState: ready, documentElement: html, scrollingElement: html,
    querySelectorAll(selector) { return descendants(html).filter(el => selector === "*" || el.matches(selector)); } };
  const context = vm.createContext({ window, document, location: { href: "https://dashboard.example/" }, URL,
    setTimeout: timer.setTimeout, clearTimeout: timer.clearTimeout });
  run(context, "shared.js"); run(context, "page-view.js");
  return { window, document, pane, titles, timer, api: context.ClearTabView,
    enableHandlers: () => { enabled = true; }, selection: () => selection, destinations: () => destinations };
}

test("Back restores selected Glance groups, page scroll and inner scroll without navigating a group link", () => {
  const before = dashboard();
  before.titles[1].click();
  before.window.scrollY = 950;
  before.pane.scrollLeft = 150;
  before.pane.scrollTop = 80;
  const saved = before.api.capture();
  assert.equal(JSON.stringify(saved).includes("do not collect"), false);
  const after = dashboard();
  let complete = 0;
  after.api.restore(saved, () => complete++);
  for (let n = 0; n < 6; n++) after.timer.tick();
  assert.equal(after.selection(), 1);
  assert.equal(after.window.scrollY, 950);
  assert.equal(after.pane.scrollLeft, 150);
  assert.equal(after.pane.scrollTop, 80);
  assert.equal(after.destinations(), 0);
  assert.equal(complete, 1);
  assert.equal(after.timer.count(), 0);
});

test("restoration waits for DOM and delayed dashboard handlers, then stops when the user interacts", () => {
  const before = dashboard(); before.titles[1].click(); before.window.scrollY = 600;
  const after = dashboard({ ready: "loading", handlers: false });
  let complete = 0;
  after.api.restore(before.api.capture(), () => complete++);
  after.timer.tick(); assert.equal(after.window.scrollY, 0);
  after.document.emit("DOMContentLoaded");
  after.timer.tick(); assert.equal(after.selection(), 0);
  after.enableHandlers(); after.timer.tick(); assert.equal(after.selection(), 1);
  after.window.emit("wheel", { isTrusted: true });
  after.window.scrollY = 123;
  after.timer.tick();
  assert.equal(after.window.scrollY, 123);
  assert.equal(complete, 1);
});

test("changed pages, missing widgets and hidden content cannot cause unlimited restoration", () => {
  const ui = dashboard();
  let complete = 0;
  ui.api.restore({ page: "https://other.example/", y: 900 }, () => complete++);
  assert.equal(ui.window.scrollY, 0);
  ui.api.restore({ page: "https://dashboard.example/", groups: [{ path: [99], selected: 1 }] }, () => complete++);
  for (let n = 0; n < 60; n++) ui.timer.tick();
  assert.equal(ui.timer.count(), 0);
  assert.equal(complete, 2);
});

function newTab({ returning = false } = {}) {
  const window = events();
  const timer = clock();
  let loads = 0;
  const elements = Object.fromEntries(["website", "notice", "open-normally", "notice-title", "notice-copy", "link-error", "retry-link", "choose", "settings"]
    .map(id => [id, { ...events(), hidden: true, attributes: {}, getAttribute(name) { return this.attributes[name] ?? null; }, removeAttribute(name) { delete this.attributes[name]; } }]));
  Object.defineProperty(elements.website, "src", { set(value) { this.attributes.src = value; loads++; } });
  const ports = [];
  const browser = { tabs: { getCurrent: async () => ({ id: 7 }) }, runtime: { openOptionsPage() {}, connect() {
    const received = [], disconnected = [];
    const port = { messages: [], onMessage: { addListener: fn => received.push(fn) }, onDisconnect: { addListener: fn => disconnected.push(fn) },
      postMessage: message => port.messages.push(message), disconnect: () => disconnected.forEach(fn => fn()),
      receive: message => received.forEach(fn => fn(message)) };
    ports.push(port); return port;
  } } };
  const context = vm.createContext({ browser, window, document: { getElementById: id => elements[id] },
    performance: { getEntriesByType: () => [{ type: returning ? "back_forward" : "navigate" }] },
    setTimeout: timer.setTimeout, clearTimeout: timer.clearTimeout });
  run(context, "newtab.js");
  return { window, ports, elements, loads: () => loads };
}

test("a fresh Back document requests restoration; a cached document reconnects without reloading its iframe", async () => {
  const reloaded = newTab({ returning: true }); await flush();
  assert.equal(reloaded.ports[0].messages[0].resume, true);
  const ui = newTab(); await flush();
  assert.equal(ui.ports[0].messages[0].resume, false);
  ui.ports[0].receive({ type: "show-page", url: "https://dashboard.example/" });
  assert.equal(ui.loads(), 1);
  ui.window.emit("pagehide", { persisted: true });
  assert.equal(ui.elements.notice.hidden, true, "Leaving is not an add-on restart error");
  ui.window.emit("pageshow", { persisted: true }); await flush();
  assert.equal(ui.ports.length, 2);
  assert.equal(ui.ports[1].messages[0].resume, true);
  ui.ports[1].receive({ type: "show-page", url: "https://dashboard.example/", resume: true });
  assert.equal(ui.loads(), 1, "Keep the cached frame and its own JavaScript state");
  ui.ports[1].receive({ type: "show-page", url: "https://dashboard.example/#section", siteURL: "https://dashboard.example/", resume: true });
  assert.equal(ui.loads(), 1, "An in-page anchor must not reload a cached frame");
  ui.ports[1].receive({ type: "show-page", url: "https://other.example/", resume: true });
  assert.equal(ui.loads(), 2, "Changed settings must still replace the old frame");
});
