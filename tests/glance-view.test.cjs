"use strict";

// Real DOM/events with simulated layout and timers. This does not test Firefox's
// history cache. Fixtures model Glance's list/grid toggles and group handlers:
// https://github.com/glanceapp/glance/blob/main/internal/glance/static/js/page.js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const root = path.join(__dirname, "..", "extension");
const page = "https://dashboard.example/";
const copy = value => JSON.parse(JSON.stringify(value));

function fixture(t, html, { loading = false } = {}) {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>${html}</body></html>`, { url: page, runScripts: "outside-only" });
  t.after(() => dom.window.close());
  const { window } = dom;
  const { document } = window;
  const pending = new Map();
  const inputListeners = new Map();
  let next = 0;
  window.setTimeout = fn => { pending.set(++next, fn); return next; };
  window.clearTimeout = id => pending.delete(id);
  Object.defineProperty(document, "readyState", { value: loading ? "loading" : "complete", configurable: true });
  Object.defineProperty(document, "scrollingElement", { value: document.documentElement });
  window.scrollTo = ({ left, top }) => { window.scrollX = left; window.scrollY = top; };
  window.Element.prototype.scrollTo = function ({ left, top }) { this.scrollLeft = left; this.scrollTop = top; };
  const add = window.addEventListener.bind(window);
  const remove = window.removeEventListener.bind(window);
  window.addEventListener = (type, fn, options) => { inputListeners.set(type, fn); add(type, fn, options); };
  window.removeEventListener = (type, fn, options) => { if (inputListeners.get(type) === fn) inputListeners.delete(type); remove(type, fn, options); };
  for (const file of ["shared.js", "page-view.js"]) window.eval(fs.readFileSync(path.join(root, file), "utf8"));
  return { window, document, api: window.ClearTabView, normalize: window.ClearTab.normalizeView,
    get: id => document.getElementById(id),
    tick(n = 1) { while (n--) { const batch = [...pending.values()]; pending.clear(); for (const fn of batch) fn(); } },
    pending: () => pending.size,
    input() { inputListeners.get("wheel")?.({ isTrusted: true }); },
    ready() { document.dispatchEvent(new window.Event("DOMContentLoaded")); } };
}

function section(id = "coverage", kind = "list") {
  return `<div id="${id}" class="${kind === "list" ? "list" : "cards-grid"} collapsible-container"
    ${kind === "list" ? 'data-collapse-after="1"' : 'data-collapse-after-rows="1"'}>
    <div>First item</div><div class="collapsible-item"><a href="https://example.com/article">More coverage</a></div>
  </div>`;
}

function wireExpansion(ui, id = "coverage") {
  const container = ui.get(id);
  const button = ui.document.createElement("button");
  button.className = "expand-toggle-button";
  button.textContent = "Show more";
  container.after(button);
  let expanded = false;
  let clicks = 0;
  button.addEventListener("click", () => {
    clicks++;
    expanded = !expanded;
    container.classList.toggle("container-expanded", expanded);
    button.classList.toggle("container-expanded", expanded);
    button.textContent = expanded ? "Show less" : "Show more";
  });
  return { container, button, expanded: () => expanded, clicks: () => clicks };
}

function group() {
  return `<section class="widget-type-group"><div class="widget-header">
    <button id="title-0" class="widget-group-title widget-group-title-current" data-title-url="https://example.com/">News</button>
    <button id="title-1" class="widget-group-title" data-title-url="https://example.com/coverage">Coverage</button>
  </div><div class="widget-group-contents"><div id="panel-0">${section("news")}</div>
    <div id="panel-1" hidden>${section()}</div></div></section><div id="scroll-pane"></div>`;
}

function wireGroup(ui) {
  let selected = 0;
  let destinations = 0;
  const titles = [ui.get("title-0"), ui.get("title-1")];
  titles.forEach((title, index) => title.addEventListener("click", () => {
    if (selected === index) { destinations++; return; }
    selected = index;
    titles.forEach((other, n) => {
      other.classList.toggle("widget-group-title-current", n === index);
      ui.get(`panel-${n}`).hidden = n !== index;
    });
  }));
  return { selected: () => selected, destinations: () => destinations };
}

for (const kind of ["list", "grid"]) {
  test(`Back reopens Glance ${kind} Show more and its Show less handler stays synchronized`, t => {
    const before = fixture(t, section("coverage", kind));
    wireExpansion(before).button.click();
    const saved = before.api.capture();
    assert.equal(saved.expansions[0].expanded, true);
    const after = fixture(t, section("coverage", kind));
    const site = wireExpansion(after);
    let done = 0;
    after.api.restore(saved, () => done++); after.tick(8);
    assert.equal(site.expanded(), true);
    assert.equal(site.container.classList.contains("container-expanded"), true);
    assert.equal(site.button.textContent, "Show less");
    assert.equal(site.clicks(), 1);
    assert.equal(after.document.activeElement, after.document.body);
    assert.equal(done, 1);
    assert.equal(after.pending(), 0);
    site.button.click();
    assert.equal(site.expanded(), false, "One Show less click must collapse the restored section");
    assert.equal(site.button.textContent, "Show more");
    assert.equal(after.api.capture().expansions[0].expanded, false);
  });
}

test("Back restores groups and both hidden/visible expansions before scroll, without activating a heading link", t => {
  const before = fixture(t, group()); wireGroup(before);
  wireExpansion(before, "news").button.click(); wireExpansion(before).button.click();
  before.get("title-1").click();
  before.window.scrollY = 950; before.get("scroll-pane").scrollLeft = 150; before.get("scroll-pane").scrollTop = 80;
  const after = fixture(t, group()); const groups = wireGroup(after);
  const news = wireExpansion(after, "news"); const coverage = wireExpansion(after);
  after.window.scrollTo = ({ left, top }) => {
    assert.equal(groups.selected(), 1, "Group selection precedes scrolling");
    assert.equal(coverage.expanded(), true, "Show more must expand before scrolling to its articles");
    after.window.scrollX = left; after.window.scrollY = top;
  };
  after.api.restore(before.api.capture(), () => {}); after.tick(8);
  assert.equal(groups.selected(), 1);
  assert.equal(groups.destinations(), 0);
  assert.equal(news.expanded(), true);
  assert.equal(coverage.expanded(), true);
  assert.equal(after.window.scrollY, 950);
  assert.equal(after.get("scroll-pane").scrollTop, 80);
  assert.equal(after.get("scroll-pane").scrollLeft, 150);
});

test("already expanded and collapsed sections are left alone; a later collapse replaces the earlier snapshot", t => {
  const before = fixture(t, section("open") + section("closed"));
  const open = wireExpansion(before, "open"); const closed = wireExpansion(before, "closed");
  open.button.click(); closed.button.click(); closed.button.click();
  const after = fixture(t, section("open") + section("closed"));
  const restoredOpen = wireExpansion(after, "open"); const restoredClosed = wireExpansion(after, "closed");
  restoredOpen.button.click();
  after.api.restore(before.api.capture(), () => {}); after.tick(8);
  assert.equal(restoredOpen.clicks(), 1, "No extra click on an already open section");
  assert.equal(restoredClosed.clicks(), 0, "Do not expand a section the user closed again");
});

test("a saved closed section is closed through Glance's handler if another restorer opened it", t => {
  const before = fixture(t, section()); wireExpansion(before);
  const after = fixture(t, section()); const site = wireExpansion(after); site.button.click();
  after.api.restore(before.api.capture(), () => {}); after.tick(8);
  assert.equal(site.expanded(), false);
  assert.equal(site.button.textContent, "Show more");
  assert.equal(site.clicks(), 2);
});

test("restoration waits for DOM readiness, asynchronously inserted widgets, and the generated toggle", t => {
  const before = fixture(t, section()); wireExpansion(before).button.click();
  const after = fixture(t, "", { loading: true });
  let done = 0;
  after.api.restore(before.api.capture(), () => done++); after.tick(3);
  assert.equal(done, 0);
  after.ready(); after.tick(2);
  after.document.body.innerHTML = section(); after.tick(2);
  const site = wireExpansion(after); after.tick(8);
  assert.equal(site.expanded(), true);
  assert.equal(done, 1);
});

test("missing or unresponsive toggles stop within the retry window and are not repeatedly clicked", t => {
  const before = fixture(t, section()); wireExpansion(before).button.click();
  const after = fixture(t, section() + '<button class="expand-toggle-button">Show more</button>');
  let clicks = 0, done = 0;
  after.get("coverage").nextElementSibling.addEventListener("click", () => clicks++);
  after.api.restore(before.api.capture(), () => done++); after.tick(60);
  assert.equal(clicks, 1);
  assert.equal(done, 1);
  assert.equal(after.pending(), 0);
  const missing = fixture(t, "");
  missing.api.restore(before.api.capture(), () => done++); missing.tick(60);
  assert.equal(missing.pending(), 0);
  assert.equal(done, 2);
});

test("user input cancels restoration before a delayed toggle appears", t => {
  const before = fixture(t, section()); wireExpansion(before).button.click();
  const after = fixture(t, section());
  after.api.restore(before.api.capture(), () => {}); after.tick(); after.input();
  const site = wireExpansion(after); after.tick(60);
  assert.equal(site.clicks(), 0);
  assert.equal(after.pending(), 0);
});

test("restoration ignores generic controls, lookalike text, changed markup, disabled buttons and form submits", t => {
  const before = fixture(t, section()); wireExpansion(before).button.click();
  const saved = before.api.capture();
  for (const markup of [
    '<details><summary>Show more</summary>Content</details>',
    '<button aria-expanded="false">Show more</button>',
    section() + '<button>Show more</button>',
    section() + '<a class="expand-toggle-button" href="https://example.com/">Show more</a>',
    section() + '<button class="expand-toggle-button" disabled>Show more</button>',
    section() + '<button class="expand-toggle-button" data-title-url="https://example.com/">Show more</button>',
    section() + '<button class="expand-toggle-button" form="checkout">Show more</button><form id="checkout"></form>',
    section().replace('data-collapse-after="1"', 'data-collapse-after="-1"') + '<button class="expand-toggle-button">Show more</button>'
  ]) {
    const ui = fixture(t, markup); let clicks = 0;
    ui.document.addEventListener("click", () => clicks++);
    assert.equal(ui.api.capture().expansions.length, 0);
    ui.api.restore(saved, () => {}); ui.tick(60);
    assert.equal(clicks, 0, markup);
  }
});

test("expansion snapshots are bounded and contain only paths and strict boolean state", t => {
  const ui = fixture(t, section() + '<input type="password" value="private-value">');
  wireExpansion(ui).button.click();
  assert.equal(JSON.stringify(ui.api.capture()).includes("private-value"), false);
  const normalized = ui.normalize({ page, html: "private-value", expansions: [
    { path: [1, 0], expanded: true, label: "private-value" },
    { path: [1, 0], expanded: "true" }, { path: [-1], expanded: true }, null
  ] }, page);
  assert.deepEqual(copy(normalized.expansions), [{ path: [1, 0], expanded: true }]);
  assert.equal(JSON.stringify(normalized).includes("private-value"), false);
  assert.equal(ui.normalize({ page, expansions: Array.from({ length: 200 }, () => ({ path: [1, 0], expanded: true })) }, page).expansions.length, 128);
  let done = 0;
  ui.api.restore({ ...ui.api.capture(), page: "https://other.example/" }, () => done++);
  assert.equal(done, 1);
  assert.equal(ui.pending(), 0);
});
