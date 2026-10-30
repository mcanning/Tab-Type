"use strict";

// Real HTML/DOM and event dispatch, with deterministic timing and simulated
// scrolling. jsdom does not model layout, Firefox's cache, or its browser UI.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const root = path.join(__dirname, "..", "extension");
const copy = value => JSON.parse(JSON.stringify(value));
const page = "https://dashboard.example/";

function fixture(t, html, { loading = false } = {}) {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>${html}</body></html>`, { url: page, runScripts: "outside-only" });
  t.after(() => dom.window.close());
  const window = dom.window;
  const document = window.document;
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
    input(type = "wheel") { inputListeners.get(type)?.({ isTrusted: true }); },
    ready() { document.dispatchEvent(new window.Event("DOMContentLoaded")); } };
}

function tabs({ tag = "button", glance = false, prefix = "news", ids = true } = {}) {
  return `<section ${ids ? `id="${prefix}"` : ""} class="${glance ? "widget-type-group" : ""}">
    <div role="tablist" ${ids ? `id="${prefix}-list"` : ""} class="${glance ? "widget-header" : ""}">
      ${[0, 1].map(n => `<${tag} id="${prefix}-tab-${n}" role="tab" aria-selected="${n === 0}"
        aria-controls="${prefix}-panel-${n}" ${tag === "a" ? `href="#${prefix}-panel-${n}"` : ""}
        ${glance ? `class="widget-group-title${n === 0 ? " widget-group-title-current" : ""}" data-title-url="https://example.com/"` : ""}>Tab ${n}</${tag}>`).join("")}
    </div>
    ${[0, 1].map(n => `<div role="tabpanel" id="${prefix}-panel-${n}" aria-labelledby="${prefix}-tab-${n}" ${n ? "hidden" : ""}>Content ${n}</div>`).join("")}
  </section>`;
}

function wireTabs(ui, prefix = "news") {
  let selected = 0;
  let activeClicks = 0;
  let changes = 0;
  const buttons = [0, 1].map(n => ui.get(`${prefix}-tab-${n}`));
  for (const [index, button] of buttons.entries()) button.addEventListener("click", event => {
    if (button.localName !== "a" && event.defaultPrevented) return;
    event.preventDefault();
    if (selected === index) { activeClicks++; return; }
    selected = index;
    changes++;
    buttons.forEach((other, n) => {
      other.setAttribute("aria-selected", String(n === index));
      ui.get(`${prefix}-panel-${n}`).hidden = n !== index;
    });
  });
  return { selected: () => selected, activeClicks: () => activeClicks, changes: () => changes };
}

for (const variant of [{ tag: "button" }, { tag: "a" }, { tag: "div" }, { glance: true }]) {
  test(`standard tab restoration updates the site's state: ${JSON.stringify(variant)}`, t => {
    const before = fixture(t, tabs(variant)); wireTabs(before);
    before.get("news-tab-1").click();
    const after = fixture(t, tabs(variant)); const site = wireTabs(after);
    const saved = before.api.capture();
    assert.equal(saved.controls[0].kind, "tab");
    let done = 0;
    after.api.restore(saved, () => done++); after.tick(8);
    assert.equal(site.selected(), 1);
    assert.equal(after.get("news-panel-1").hidden, false);
    assert.equal(site.changes(), 1);
    assert.equal(site.activeClicks(), 0, "Already-active headings must never be clicked");
    assert.equal(after.document.activeElement, after.document.body, "No extension focus call");
    assert.equal(done, 1);
    assert.equal(after.pending(), 0);
  });
}

test("unique IDs preserve tab and panel identity when content is inserted or reordered", t => {
  const before = fixture(t, tabs() + '<div id="feed"></div>'); wireTabs(before);
  before.get("news-tab-1").click(); before.window.scrollY = 900;
  before.get("feed").scrollLeft = -120; before.get("feed").scrollTop = 70;
  const after = fixture(t, '<aside>New content</aside><div id="feed"></div>' + tabs());
  const site = wireTabs(after);
  after.get("news-list").prepend(after.get("news-tab-1"));
  after.api.restore(before.api.capture(), () => {}); after.tick(8);
  assert.equal(site.selected(), 1);
  assert.equal(after.window.scrollY, 900);
  assert.equal(after.get("feed").scrollLeft, -120);
  assert.equal(after.get("feed").scrollTop, 70);
});

test("multiple and nested tablists restore independently without CSS class assumptions", t => {
  const html = tabs({ prefix: "outer" }) + tabs({ prefix: "other" });
  const before = fixture(t, html); const after = fixture(t, html);
  for (const ui of [before, after]) ui.get("outer-panel-1").innerHTML = tabs({ prefix: "inner", ids: false });
  const sites = [];
  for (const prefix of ["outer", "inner", "other"]) {
    wireTabs(before, prefix); before.get(`${prefix}-tab-1`).click(); sites.push(wireTabs(after, prefix));
  }
  after.api.restore(before.api.capture(), () => {}); after.tick(8);
  assert.deepEqual(sites.map(site => site.selected()), [1, 1, 1]);
});

test("native details restores both closed and open sections, including controls without IDs", t => {
  const html = '<details id="first" name="group" open><summary>First</summary>A</details><details id="second" name="group"><summary>Second</summary>B</details><details><summary>Other</summary>C</details>';
  const before = fixture(t, html);
  before.get("first").open = false; before.get("second").open = true;
  before.document.querySelector("details:last-child").open = true;
  const after = fixture(t, html);
  after.api.restore(before.api.capture(), () => {}); after.tick(8);
  assert.deepEqual([...after.document.querySelectorAll("details")].map(el => el.open), [false, true, true]);
});

test("restoration follows replaced DOM nodes and never clicks a detached control", t => {
  const before = fixture(t, tabs({ prefix: "outer" }));
  before.get("outer-panel-1").innerHTML = tabs({ prefix: "inner" });
  wireTabs(before, "outer"); wireTabs(before, "inner");
  before.get("outer-tab-1").click(); before.get("inner-tab-1").click();
  const after = fixture(t, tabs({ prefix: "outer" }));
  after.get("outer-panel-1").innerHTML = tabs({ prefix: "inner" });
  wireTabs(after, "outer");
  let detachedClicks = 0; let inner;
  after.get("inner-tab-1").addEventListener("click", () => detachedClicks++);
  after.get("outer-tab-1").addEventListener("click", () => {
    after.get("outer-panel-1").innerHTML = tabs({ prefix: "inner" });
    inner = wireTabs(after, "inner");
  });
  after.api.restore(before.api.capture(), () => {}); after.tick(8);
  assert.equal(detachedClicks, 0);
  assert.equal(inner.selected(), 1);
  assert.equal(inner.changes(), 1);
});

test("ARIA accordion restoration invokes the site's own handler once for each changed section", t => {
  const html = [0, 1].map(n => `<h3><button type="button" id="heading-${n}" aria-expanded="${n === 0}" aria-controls="section-${n}">Section ${n}</button></h3><div id="section-${n}" role="region" aria-labelledby="heading-${n}">Content</div>`).join("");
  function wire(ui) {
    let clicks = 0;
    for (const n of [0, 1]) ui.get(`heading-${n}`).addEventListener("click", () => {
      clicks++;
      const expanded = ui.get(`heading-${n}`).getAttribute("aria-expanded") !== "true";
      ui.get(`heading-${n}`).setAttribute("aria-expanded", String(expanded));
      ui.get(`section-${n}`).hidden = !expanded;
    });
    return () => clicks;
  }
  const before = fixture(t, html); wire(before);
  before.get("heading-0").click(); before.get("heading-1").click();
  const after = fixture(t, html); const clicks = wire(after);
  after.api.restore(before.api.capture(), () => {}); after.tick(8);
  assert.equal(after.get("section-0").hidden, true);
  assert.equal(after.get("section-1").hidden, false);
  assert.equal(clicks(), 2);
});

test("forms, external links, popups, editable content and disabled controls are never activated", t => {
  const before = fixture(t, tabs()); wireTabs(before); before.get("news-tab-1").click();
  const saved = before.api.capture();
  for (const alter of [
    ui => { const form = ui.document.createElement("form"); ui.document.body.append(form); form.append(ui.get("news")); },
    ui => ui.get("news-tab-1").setAttribute("disabled", ""),
    ui => ui.get("news-tab-1").setAttribute("aria-disabled", "true"),
    ui => ui.get("news-tab-1").setAttribute("aria-haspopup", "dialog"),
    ui => ui.get("news-tab-1").setAttribute("formaction", "/submit"),
    ui => ui.get("news-list").setAttribute("aria-disabled", "true"),
    ui => ui.get("news").setAttribute("contenteditable", "true"),
    ui => ui.get("news").setAttribute("inert", "")
  ]) {
    const after = fixture(t, tabs()); alter(after);
    let clicks = 0; after.get("news-tab-1").addEventListener("click", () => clicks++);
    after.api.restore(saved, () => {}); after.tick(60); assert.equal(clicks, 0);
  }
  for (const href of ["https://other.example/", "/different#part", "javascript:alert(1)"]) {
    const ui = fixture(t, tabs({ tag: "a" })); ui.get("news-tab-0").setAttribute("href", href);
    assert.equal(ui.api.capture().controls.length, 0);
  }
  const popup = fixture(t, '<button id="menu-button" aria-expanded="true" aria-controls="menu">Menu</button><div id="menu" role="menu" aria-labelledby="menu-button"></div><button aria-expanded="true">Unrelated</button>');
  assert.equal(popup.api.capture().controls.length, 0);
});

test("changed IDs, duplicate IDs and different panel semantics do not restore the wrong control", t => {
  const before = fixture(t, tabs()); wireTabs(before); before.get("news-tab-1").click();
  for (const alter of [
    ui => { ui.get("news-tab-1").id = "replacement"; },
    ui => ui.document.body.append(ui.get("news-tab-1").cloneNode(true)),
    ui => ui.get("news-panel-1").setAttribute("role", "dialog"),
    ui => ui.get("news-tab-1").setAttribute("aria-controls", "news-panel-0"),
    ui => ui.get("news-list").removeAttribute("role")
  ]) {
    const after = fixture(t, tabs()); let clicks = 0;
    after.get("news-tab-1").addEventListener("click", () => clicks++); alter(after);
    after.api.restore(before.api.capture(), () => {}); after.tick(60);
    assert.equal(clicks, 0); assert.equal(after.pending(), 0);
  }
});

test("unresponsive controls are clicked at most once and retries are bounded", t => {
  const before = fixture(t, tabs()); wireTabs(before); before.get("news-tab-1").click();
  const after = fixture(t, tabs()); let clicks = 0; let done = 0;
  after.get("news-tab-1").addEventListener("click", () => clicks++);
  after.api.restore(before.api.capture(), () => done++); after.tick(60);
  assert.equal(clicks, 1); assert.equal(done, 1); assert.equal(after.pending(), 0);
});

test("restoring an unhandled anchor tab cancels native navigation and history changes", async t => {
  const before = fixture(t, tabs({ tag: "a" })); wireTabs(before); before.get("news-tab-1").click();
  const after = fixture(t, tabs({ tag: "a" })); let event;
  after.get("news-tab-1").addEventListener("click", e => { event = e; });
  after.api.restore(before.api.capture(), () => {}); after.tick(60);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(event.defaultPrevented, true);
  assert.equal(after.window.location.href, page);
  assert.equal(after.window.history.length, 1);
});

test("custom tabs nested inside links or form labels are excluded", t => {
  for (const tag of ["a", "label", "button"]) {
    const ui = fixture(t, tabs({ tag: "div" }));
    const wrapper = ui.document.createElement(tag);
    if (tag === "a") wrapper.href = "https://other.example/";
    ui.get("news-tab-0").replaceWith(wrapper);
    wrapper.innerHTML = '<div role="tab" aria-selected="true" aria-controls="news-panel-0">Unsafe nested control</div>';
    assert.equal(ui.api.capture().controls.length, 0);
  }
});

test("DOMContentLoaded and late inserted controls are handled, then genuine user input takes over", t => {
  const before = fixture(t, tabs()); wireTabs(before); before.get("news-tab-1").click(); before.window.scrollY = 600;
  const after = fixture(t, "", { loading: true }); let done = 0;
  after.api.restore(before.api.capture(), () => done++); after.tick(); assert.equal(after.window.scrollY, 0);
  after.ready(); after.tick(); assert.equal(after.window.scrollY, 600);
  after.document.body.innerHTML = tabs(); const site = wireTabs(after); after.tick();
  assert.equal(site.selected(), 1);
  after.input(); after.window.scrollY = 123; after.tick(10);
  assert.equal(after.window.scrollY, 123); assert.equal(done, 1); assert.equal(after.pending(), 0);
});

test("changed pages are rejected, missing controls time out, and cancellation removes pending startup", t => {
  const ui = fixture(t, "", { loading: true }); let done = 0;
  ui.api.restore({ page: "https://other.example/", y: 900 }, () => done++);
  assert.equal(ui.window.scrollY, 0);
  const stop = ui.api.restore({ page, y: 900 }, () => done++); stop(); ui.ready(); ui.tick(60);
  assert.equal(ui.window.scrollY, 0); assert.equal(done, 2); assert.equal(ui.pending(), 0);
  const missing = fixture(t, "");
  missing.api.restore({ page, controls: [{ kind: "details", target: { path: [1, 99], tag: "details", id: "missing" }, value: true }] }, () => done++);
  missing.tick(60); assert.equal(done, 3); assert.equal(missing.pending(), 0);
});

test("snapshots exclude form contents and arbitrary state, bound fields, and retain RTL scrolling", t => {
  const ui = fixture(t, '<input type="password" value="private-secret"><textarea>private-secret</textarea><details id="fold"><summary>Title</summary>private-secret</details>');
  const saved = copy(ui.api.capture());
  assert.equal(JSON.stringify(saved).includes("private-secret"), false);
  const control = { kind: "details", target: { path: [1, 0], tag: "details", id: "fold", html: "private-secret" }, value: true, password: "private-secret" };
  const clean = copy(ui.normalize({ page, x: -500, y: Infinity, controls: Array(200).fill(control),
    scroll: Array(200).fill({ target: control.target, x: -1e20, y: 1e20 }), html: "private-secret" }, page));
  assert.equal(clean.x, -500); assert.equal(clean.y, 0);
  assert.equal(clean.controls.length, 128); assert.equal(clean.scroll.length, 128);
  assert.equal(clean.scroll[0].x, -10000000); assert.equal(clean.scroll[0].y, 10000000);
  assert.equal(JSON.stringify(clean).includes("private-secret"), false);
  assert.equal(ui.normalize({ page, controls: [
    { ...control, value: "true" }, { ...control, kind: "submit" },
    { ...control, target: { path: [-1], tag: "details" } },
    { ...control, target: { path: Array(33).fill(0), tag: "details" } },
    { ...control, target: { path: [1], tag: "details", id: "x".repeat(257) } }
  ] }, page).controls.length, 0);
});
