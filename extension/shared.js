"use strict";

// Shared validation is used by both privileged code and the page bridge.
globalThis.ClearTab = Object.freeze({
  normalizeWebsite(value) {
    if (typeof value !== "string" || !value.trim() || value.length > 4096) {
      throw new Error("Enter a website address.");
    }
    let input = value.trim();
    if (!/^[a-z][a-z0-9+.-]*:/i.test(input)) input = `https://${input}`;
    const url = new URL(input);
    if (!["https:", "http:"].includes(url.protocol)) {
      throw new Error("Use an https:// or http:// website address.");
    }
    if (url.username || url.password) throw new Error("Use an address without a username or password.");
    return url.href;
  },

  permissionPattern(value) {
    const url = new URL(value);
    // Firefox match patterns do not include ports. Authorization below also
    // checks the exact origin, including its port, before using a page bridge.
    return `${url.protocol}//${url.hostname}/*`;
  },

  // Only bounded coordinates and standard control state cross the bridge.
  // Never retain page HTML, form values, or arbitrary script state.
  normalizeView(value, page) {
    if (!value || value.page !== page || typeof page !== "string" || page.length > 4096) return null;
    // Horizontal scrolling can be negative on right-to-left pages.
    const coordinate = n => Number.isFinite(n) ? Math.max(-10000000, Math.min(10000000, n)) : 0;
    const path = p => Array.isArray(p) && p.length > 0 && p.length <= 32 &&
      p.every(n => Number.isInteger(n) && n >= 0 && n < 100000) ? [...p] : null;
    const locator = value => {
      const location = path(value?.path);
      if (!location || typeof value.tag !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(value.tag)) return null;
      const result = { path: location, tag: value.tag };
      if (value.id !== undefined) {
        if (typeof value.id !== "string" || !value.id || value.id.length > 256) return null;
        result.id = value.id;
      }
      return result;
    };
    const controls = [];
    const scroll = [];
    for (const item of (Array.isArray(value.controls) ? value.controls : []).slice(0, 128)) {
      const target = locator(item?.target);
      if (!target) continue;
      if (item.kind === "details" && target.tag === "details" && typeof item.value === "boolean") {
        controls.push({ kind: "details", target, value: item.value });
      } else if (item.kind === "tab" || item.kind === "disclosure") {
        const panel = locator(item.panel);
        if (!panel?.id) continue;
        if (item.kind === "tab") {
          const list = locator(item.list);
          if (list) controls.push({ kind: "tab", target, panel, list });
        } else if (typeof item.value === "boolean") {
          controls.push({ kind: "disclosure", target, panel, value: item.value });
        }
      }
    }
    for (const item of (Array.isArray(value.scroll) ? value.scroll : []).slice(0, 128)) {
      const target = locator(item?.target);
      if (target) scroll.push({ target, x: coordinate(item.x), y: coordinate(item.y) });
    }
    return { page, x: coordinate(value.x), y: coordinate(value.y), controls, scroll };
  },

  isPageAnchor(href, currentURL, rawHref = "") {
    const target = new URL(href, currentURL);
    const current = new URL(currentURL);
    return (Boolean(target.hash) || rawHref.trim().startsWith("#")) && target.origin === current.origin &&
      target.pathname === current.pathname && target.search === current.search;
  }
});
