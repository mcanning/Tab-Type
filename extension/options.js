"use strict";

const field = document.getElementById("website-url");
const status = document.getElementById("status");
const save = document.getElementById("save");
let previousURL = null;
let edited = false;
field.addEventListener("input", () => { edited = true; });

void browser.runtime.sendMessage({ type: "configuration" }).then(config => {
  if (config?.url) {
    previousURL = config.url;
    if (!edited) field.value = config.url;
  }
}).catch(() => {});

document.getElementById("settings-form").addEventListener("submit", async event => {
  event.preventDefault();
  status.textContent = "";
  try {
    const url = ClearTab.normalizeWebsite(field.value);
    const pattern = ClearTab.permissionPattern(url);
    // Request inside the user's submit gesture, before any await.
    const permission = browser.permissions.request({ origins: [pattern] });
    save.disabled = true;
    if (!(await permission)) {
      status.textContent = "Permission wasn’t granted. Your website was not changed.";
      return;
    }
    const result = await browser.runtime.sendMessage({ type: "configure", url });
    if (!result?.ok) throw new Error("Couldn’t save the website. Try again.");
    if (previousURL && ClearTab.permissionPattern(previousURL) !== pattern) {
      await browser.permissions.remove({ origins: [ClearTab.permissionPattern(previousURL)] }).catch(() => {});
    }
    previousURL = field.value = url;
    status.textContent = "Saved. Open a new tab to try it.";
  } catch (error) {
    status.textContent = error.message || "Couldn’t save that website address.";
  } finally {
    save.disabled = false;
  }
});
