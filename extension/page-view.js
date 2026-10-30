"use strict";

globalThis.ClearTabView = (() => {
  function pathFor(element) {
    const path = [];
    while (element && element !== document.documentElement) {
      const parent = element.parentElement;
      if (!parent || path.length === 32) return null;
      path.unshift(Array.prototype.indexOf.call(parent.children, element));
      element = parent;
    }
    return path.length ? path : null;
  }

  function indexIDs() {
    const ids = new Map();
    for (const element of document.querySelectorAll("[id]")) {
      if (element.id) ids.set(element.id, ids.has(element.id) ? null : element);
    }
    return ids;
  }

  function locate(element, ids) {
    const path = pathFor(element);
    if (!path) return null;
    const target = { path, tag: element.localName };
    if (element.id) {
      if (element.id.length > 256 || ids.get(element.id) !== element) return null;
      target.id = element.id;
    }
    return target;
  }

  function resolve(target, ids) {
    let element;
    if (target.id) element = ids.get(target.id);
    else {
      element = document.documentElement;
      for (const index of target.path) element = element?.children[index];
    }
    // A missing ID must not fall back to a different control at the old path.
    return element?.isConnected && element.localName === target.tag ? element : null;
  }

  function panelFor(element, ids) {
    const id = element.getAttribute("aria-controls")?.trim();
    return id && !/\s/.test(id) ? ids.get(id) : null;
  }

  function safeActivation(element) {
    if (element.matches(":disabled") || element.closest("[aria-disabled='true'], [inert], [contenteditable]:not([contenteditable='false'])")) return false;
    const interactive = element.closest("a[href], button, input, select, textarea, summary, label");
    if (interactive && interactive !== element) return false;
    if (element.hasAttribute("formaction") || element.hasAttribute("download")) return false;
    const popup = element.getAttribute("aria-haspopup");
    if (popup && popup !== "false") return false;
    if (element.localName === "button") return !element.form || element.type === "button";
    if (element.localName === "a") {
      const target = element.getAttribute("target") ?? document.querySelector("base[target]")?.getAttribute("target");
      const href = element.getAttribute("href");
      if (!href || (target && target.toLowerCase() !== "_self")) return false;
      try { return ClearTab.isPageAnchor(new URL(href, document.baseURI).href, location.href, href); }
      catch (_) { return false; }
    }
    return ["div", "span", "li"].includes(element.localName);
  }

  function tabParts(element, ids) {
    if (!element.matches("[role='tab']") || !safeActivation(element)) return null;
    const list = element.closest("[role='tablist']");
    const panel = panelFor(element, ids);
    if (!list || !panel?.matches("[role='tabpanel']")) return null;
    if (!["true", "false"].includes(element.getAttribute("aria-selected"))) return null;
    return { list, panel };
  }

  function disclosurePanel(element, ids) {
    if (!element.matches("button, [role='button']") || element.matches("[role='tab']") || !safeActivation(element)) return null;
    if (!["true", "false"].includes(element.getAttribute("aria-expanded"))) return null;
    const panel = panelFor(element, ids);
    // Only labelled content regions qualify. Do not replay menu, dialog, form,
    // or unrelated action buttons just because they have aria-expanded.
    if (!element.id || ids.get(element.id) !== element || !panel?.matches("[role='region']")) return null;
    return panel.getAttribute("aria-labelledby")?.split(/\s+/).includes(element.id) ? panel : null;
  }

  function capture() {
    const ids = indexIDs();
    const controls = [];
    const scroll = [];
    const lists = new Set();
    for (const element of document.querySelectorAll("[role='tab'][aria-selected='true'], details, [aria-expanded][aria-controls]")) {
      const target = locate(element, ids);
      if (!target) continue;
      if (element.localName === "details") controls.push({ kind: "details", target, value: element.open });
      else {
        const tab = tabParts(element, ids);
        if (tab) {
          const list = locate(tab.list, ids);
          const panel = locate(tab.panel, ids);
          if (list && panel && !lists.has(tab.list)) {
            controls.push({ kind: "tab", target, list, panel });
            lists.add(tab.list);
          }
        } else {
          const panel = disclosurePanel(element, ids);
          const savedPanel = panel && locate(panel, ids);
          if (savedPanel) controls.push({ kind: "disclosure", target, panel: savedPanel, value: element.getAttribute("aria-expanded") === "true" });
        }
      }
      if (controls.length === 128) break;
    }
    for (const element of document.querySelectorAll("*")) {
      if (element === document.scrollingElement || (!element.scrollLeft && !element.scrollTop)) continue;
      const target = locate(element, ids);
      if (target) scroll.push({ target, x: element.scrollLeft, y: element.scrollTop });
      if (scroll.length === 128) break;
    }
    return ClearTab.normalizeView({ page: location.href, x: window.scrollX, y: window.scrollY, controls, scroll }, location.href);
  }

  function restore(raw, done) {
    const view = ClearTab.normalizeView(raw, location.href);
    if (!view) { done(); return () => {}; }
    let stopped = false;
    let timer;
    let attempts = 0;
    let stable = 0;
    const activated = new WeakSet();
    // Close old accordion sections before opening the requested one.
    const controls = [...view.controls].sort((a, b) => Number(a.value !== false) - Number(b.value !== false));
    const inputs = ["pointerdown", "wheel", "touchstart", "keydown"];
    function stop() {
      if (stopped) return;
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("DOMContentLoaded", schedule);
      for (const type of inputs) window.removeEventListener(type, interrupt, true);
      done();
    }
    function interrupt(event) { if (event.isTrusted) stop(); }
    function restoreControl(saved, ids) {
      const element = resolve(saved.target, ids);
      if (!element) return false;
      if (saved.kind === "details") {
        if (element.open !== saved.value) element.open = saved.value;
        return element.open === saved.value;
      }
      let attribute;
      let wanted;
      if (saved.kind === "tab") {
        const tab = tabParts(element, ids);
        if (!tab || tab.list !== resolve(saved.list, ids) || tab.panel !== resolve(saved.panel, ids)) return false;
        attribute = "aria-selected";
        wanted = "true";
      } else {
        const panel = disclosurePanel(element, ids);
        if (!panel || panel !== resolve(saved.panel, ids)) return false;
        attribute = "aria-expanded";
        wanted = String(saved.value);
      }
      if (element.getAttribute(attribute) === wanted) return true;
      if (!activated.has(element)) {
        activated.add(element);
        // Let the site's handler update its internal state too. Never activate
        // an already selected tab, or repeatedly click an unresponsive control.
        // Suppress anchor navigation so restoring cannot add a history entry.
        // Leave button events alone: some tab libraries ignore canceled events.
        const preventDefault = event => event.preventDefault();
        if (element.localName === "a") element.addEventListener("click", preventDefault, { capture: true });
        try { element.click(); }
        finally { element.removeEventListener("click", preventDefault, true); }
      }
      return element.getAttribute(attribute) === wanted;
    }
    function attempt() {
      if (stopped) return;
      const ids = indexIDs();
      let complete = true;
      for (const saved of controls) {
        if (stopped) return;
        if (!restoreControl(saved, ids)) complete = false;
      }
      for (const saved of view.scroll) {
        const element = resolve(saved.target, ids);
        if (!element) { complete = false; continue; }
        element.scrollTo({ left: saved.x, top: saved.y, behavior: "instant" });
        if (Math.abs(element.scrollLeft - saved.x) > 1 || Math.abs(element.scrollTop - saved.y) > 1) complete = false;
      }
      window.scrollTo({ left: view.x, top: view.y, behavior: "instant" });
      if (Math.abs(window.scrollX - view.x) > 1 || Math.abs(window.scrollY - view.y) > 1) complete = false;
      stable = complete ? stable + 1 : 0;
      // Allow deferred controls and layout to settle for up to five seconds.
      // Genuine user input takes over immediately.
      if (++attempts >= 50 || stable >= 5) stop();
      else timer = setTimeout(attempt, 100);
    }
    function schedule() { timer = setTimeout(attempt, 0); }
    for (const type of inputs) window.addEventListener(type, interrupt, true);
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", schedule, { once: true });
    else schedule();
    return stop;
  }

  return Object.freeze({ capture, restore });
})();
