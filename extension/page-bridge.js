"use strict";

(() => {
  // Only the direct child of a tab can be our start page. Normal visits to the
  // chosen site and its advertisement/subframes receive no handlers or changes.
  if (window === window.top || window.parent !== window.top) return;
  let token = null;
  let opening = false;
  let active = true;
  let restoring = false;
  let stopRestore = null;
  let saveTimer;
  let authTimer;
  let authVersion = 0;
  let authenticating = false;
  let restoredFromCache = false;

  function saveView() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (!token || restoring || !active || opening) return;
    void browser.runtime.sendMessage({ type: "save-view", token, view: ClearTabView.capture() }).catch(() => {});
  }

  function queueSave() {
    if (token && active && !restoring && !saveTimer) saveTimer = setTimeout(saveView, 200);
  }

  async function authorize(preserved = false, attempt = 0) {
    if (authenticating || !active) return;
    authenticating = true;
    clearTimeout(authTimer);
    const version = ++authVersion;
    try {
      const result = await browser.runtime.sendMessage({ type: "bridge-ready" });
      if (!active || version !== authVersion) return;
      if (!result?.ok) {
        if (attempt < 20) authTimer = setTimeout(() => void authorize(preserved, attempt + 1), 100);
        return;
      }
      const sameSession = token === result.token;
      token = result.token;
      opening = false;
      if (sameSession) return;
      stopRestore?.();
      if (result.view && !preserved) {
        restoring = true;
        stopRestore = ClearTabView.restore(result.view, () => {
          restoring = false;
          stopRestore = null;
          queueSave();
        });
      } else queueSave();
    } catch (_) { /* A normal site frame or a closing extension has no session. */ }
    finally { if (version === authVersion) authenticating = false; }
  }

  function linkFrom(event) {
    return event.composedPath().find(node =>
      node?.nodeType === 1 && (
        (["a", "area"].includes(node.localName) && node.hasAttribute("href")) ||
        node.matches("button.widget-group-title-current[data-title-url]")
      ));
  }

  function defaultTarget() {
    return document.querySelector("base[target]")?.getAttribute("target") || "";
  }

  // Register before the site's routers install their own click handlers.
  window.addEventListener("click", event => {
    if (!token || !event.isTrusted || event.button !== 0 ||
        event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const link = linkFrom(event);
    if (!link || link.hasAttribute("download")) return;
    // Always promote ordinary clicks, even when markup initially says _blank:
    // a later dashboard handler may change that target to _self. Glance also
    // implements its active group-heading links as buttons with data-title-url.
    const raw = link.getAttribute("href") ?? link.getAttribute("data-title-url");
    let href;
    try {
      href = new URL(raw, document.baseURI).href;
      if (ClearTab.normalizeWebsite(href) !== href || ClearTab.isPageAnchor(href, location.href, raw)) return;
    } catch (_) { return; }
    event.preventDefault();
    event.stopImmediatePropagation();
    if (opening) return;
    opening = true;
    void browser.runtime.sendMessage({ type: "open-link", href, token, view: ClearTabView.capture() })
      .then(result => { if (!result?.ok) opening = false; })
      .catch(() => { opening = false; });
  }, true);

  function promoteForm(form, submitter) {
    if (!form || form.localName !== "form") return;
    const explicit = submitter?.getAttribute("formtarget");
    const target = (explicit ?? form.getAttribute("target") ?? defaultTarget()).toLowerCase();
    if (target === "_blank") return;
    if (submitter && explicit !== null && explicit !== undefined) submitter.setAttribute("formtarget", "_top");
    form.setAttribute("target", "_top");
  }

  // Preserve native form submission, including POST bodies and validation.
  // Do not turn form submissions into a tabs.update GET request.
  window.addEventListener("submit", event => {
    if (token && event.isTrusted) {
      saveView();
      promoteForm(event.target, event.submitter);
    }
  }, true);

  window.addEventListener("scroll", queueSave, true);
  window.addEventListener("click", queueSave);
  window.addEventListener("keyup", queueSave);
  window.addEventListener("toggle", queueSave, true);
  window.addEventListener("pagehide", event => {
    saveView();
    active = false;
    token = null;
    opening = false;
    ++authVersion;
    authenticating = false;
    restoredFromCache = event.persisted;
    clearTimeout(authTimer);
    clearTimeout(saveTimer);
    stopRestore?.();
  });
  window.addEventListener("pageshow", event => {
    active = true;
    if (event.persisted) {
      restoredFromCache = true;
      void authorize(true);
    }
  });
  browser.runtime.onMessage.addListener((message, sender) => {
    if (message?.type === "resume-bridge" && sender.id === browser.runtime.id) void authorize(restoredFromCache);
  });
  void authorize();
})();
