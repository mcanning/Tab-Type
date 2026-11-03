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

  // Only bounded coordinates, Glance group selections and expansion states cross the bridge.
  // Never retain page HTML, form values, or arbitrary script state.
  normalizeView(value, page) {
    if (!value || value.page !== page || typeof page !== "string" || page.length > 4096) return null;
    const coordinate = n => Number.isFinite(n) ? Math.max(0, Math.min(10000000, n)) : 0;
    const path = p => Array.isArray(p) && p.length > 0 && p.length <= 32 &&
      p.every(n => Number.isInteger(n) && n >= 0 && n < 100000) ? [...p] : null;
    const groups = [];
    const expansions = [];
    const scroll = [];
    for (const item of (Array.isArray(value.groups) ? value.groups : []).slice(0, 64)) {
      const location = path(item?.path);
      if (location && Number.isInteger(item.selected) && item.selected >= 0 && item.selected < 256) {
        groups.push({ path: location, selected: item.selected });
      }
    }
    for (const item of (Array.isArray(value.expansions) ? value.expansions : []).slice(0, 128)) {
      const location = path(item?.path);
      if (location && typeof item.expanded === "boolean") {
        expansions.push({ path: location, expanded: item.expanded });
      }
    }
    for (const item of (Array.isArray(value.scroll) ? value.scroll : []).slice(0, 128)) {
      const location = path(item?.path);
      if (location) scroll.push({ path: location, x: coordinate(item.x), y: coordinate(item.y) });
    }
    return { page, x: coordinate(value.x), y: coordinate(value.y), groups, expansions, scroll };
  },

  isPageAnchor(href, currentURL, rawHref = "") {
    const target = new URL(href, currentURL);
    const current = new URL(currentURL);
    return (Boolean(target.hash) || rawHref.trim().startsWith("#")) && target.origin === current.origin &&
      target.pathname === current.pathname && target.search === current.search;
  }
});
