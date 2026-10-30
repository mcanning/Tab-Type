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

  isPageAnchor(href, currentURL, rawHref = "") {
    const target = new URL(href, currentURL);
    const current = new URL(currentURL);
    return (Boolean(target.hash) || rawHref.trim().startsWith("#")) && target.origin === current.origin &&
      target.pathname === current.pathname && target.search === current.search;
  }
});
