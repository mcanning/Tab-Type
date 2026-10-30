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

  function atPath(path) {
    let node = document.documentElement;
    for (const index of path) node = node?.children[index];
    return node;
  }

  function capture() {
    const groups = [];
    const scroll = [];
    for (const group of document.querySelectorAll(".widget-type-group")) {
      const titles = group.querySelector(".widget-header")?.children;
      const selected = titles ? Array.prototype.findIndex.call(titles,
        title => title.classList.contains("widget-group-title-current")) : -1;
      const path = pathFor(group);
      if (path && selected >= 0) groups.push({ path, selected });
      if (groups.length === 64) break;
    }
    for (const element of document.querySelectorAll("*")) {
      if (element === document.scrollingElement || (!element.scrollLeft && !element.scrollTop)) continue;
      const path = pathFor(element);
      if (path) scroll.push({ path, x: element.scrollLeft, y: element.scrollTop });
      if (scroll.length === 128) break;
    }
    return ClearTab.normalizeView({ page: location.href, x: window.scrollX, y: window.scrollY, groups, scroll }, location.href);
  }

  function restore(raw, done) {
    const view = ClearTab.normalizeView(raw, location.href);
    if (!view) { done(); return () => {}; }
    let stopped = false;
    let timer;
    let attempts = 0;
    let stable = 0;
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
    function attempt() {
      if (stopped) return;
      let complete = true;
      for (const saved of view.groups) {
        const group = atPath(saved.path);
        const title = group?.matches(".widget-type-group") &&
          group.querySelector(".widget-header")?.children[saved.selected];
        if (!title?.matches("button.widget-group-title")) { complete = false; continue; }
        if (!title.classList.contains("widget-group-title-current")) {
          // Invoke the dashboard's own group handler so its internal selection
          // agrees with its visible classes. Never click an already active link.
          title.click();
          if (!title.classList.contains("widget-group-title-current")) complete = false;
        }
      }
      for (const saved of view.scroll) {
        const element = atPath(saved.path);
        if (!element) { complete = false; continue; }
        element.scrollTo({ left: saved.x, top: saved.y, behavior: "instant" });
        if (Math.abs(element.scrollLeft - saved.x) > 1 || Math.abs(element.scrollTop - saved.y) > 1) complete = false;
      }
      window.scrollTo({ left: view.x, top: view.y, behavior: "instant" });
      if (Math.abs(window.scrollX - view.x) > 1 || Math.abs(window.scrollY - view.y) > 1) complete = false;
      stable = complete ? stable + 1 : 0;
      // Allow deferred widgets, layout and images to settle. User input always
      // wins, and missing/changed widgets cannot leave a permanent retry loop.
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
