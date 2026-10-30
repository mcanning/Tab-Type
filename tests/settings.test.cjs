"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const flush = () => new Promise(resolve => setImmediate(resolve));

function settings({ grant = true, existing = "https://old.example/", delayed = false } = {}) {
  const elements = Object.fromEntries(["website-url", "status", "save", "settings-form"].map(id => [id, {
    value: "", textContent: "", disabled: false, listeners: {},
    addEventListener(type, callback) { this.listeners[type] = callback; }
  }]));
  const calls = [];
  let releaseConfig;
  const configPromise = new Promise(resolve => { releaseConfig = () => resolve({ url: existing }); });
  const browser = {
    runtime: { sendMessage: async message => {
      calls.push({ kind: "message", ...message });
      if (message.type === "configuration") return delayed ? configPromise : { url: existing };
      return { ok: true, url: message.url };
    } },
    permissions: {
      request: async value => { calls.push({ kind: "request", origins: Array.from(value.origins) }); return grant; },
      remove: async value => { calls.push({ kind: "remove", origins: Array.from(value.origins) }); return true; }
    }
  };
  const context = vm.createContext({ browser, document: { getElementById: id => elements[id] }, URL });
  for (const file of ["shared.js", "options.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "extension", file), "utf8"), context, { filename: file });
  }
  const submit = () => elements["settings-form"].listeners.submit({ preventDefault() {} });
  return { elements, calls, submit, releaseConfig };
}

test("saving requests only the chosen site, then saves and releases the previous site", async () => {
  const ui = settings();
  await flush();
  ui.elements["website-url"].value = "www.mlb.com";
  const pending = ui.submit();
  // The permission call must occur synchronously in the submit gesture.
  assert.deepEqual(ui.calls.at(-1), { kind: "request", origins: ["https://www.mlb.com/*"] });
  await pending;
  assert.deepEqual(ui.calls.at(-2), { kind: "message", type: "configure", url: "https://www.mlb.com/" });
  assert.deepEqual(ui.calls.at(-1), { kind: "remove", origins: ["https://old.example/*"] });
  assert.equal(ui.elements.save.disabled, false);
  assert.match(ui.elements.status.textContent, /Saved/);
});

test("declining permission leaves the saved site and existing permission unchanged", async () => {
  const ui = settings({ grant: false });
  await flush();
  ui.elements["website-url"].value = "www.mlb.com";
  await ui.submit();
  assert.equal(ui.calls.some(call => call.type === "configure" || call.kind === "remove"), false);
  assert.match(ui.elements.status.textContent, /not changed/);
  assert.equal(ui.elements.save.disabled, false);
});

test("invalid addresses fail before requesting any access", async () => {
  const ui = settings();
  await flush();
  ui.elements["website-url"].value = "javascript:alert(1)";
  await ui.submit();
  assert.equal(ui.calls.some(call => call.kind === "request"), false);
  assert.match(ui.elements.status.textContent, /https/);
});

test("late settings load cannot overwrite an address the user is typing", async () => {
  const ui = settings({ delayed: true });
  ui.elements["website-url"].value = "https://new.example/";
  ui.elements["website-url"].listeners.input();
  ui.releaseConfig();
  await flush();
  assert.equal(ui.elements["website-url"].value, "https://new.example/");
});
