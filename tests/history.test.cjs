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
