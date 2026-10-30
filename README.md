<p align="center">
  <img src="extension/icons/icon-128.png" width="96" height="96" alt="Tab & Type icon">
</p>

# Tab & Type

**Your page, ready to search.**

Tab & Type is a Firefox extension that shows your chosen website on new tabs,
leaves the new-tab address bar empty, and opens ordinary links in the full tab.
Your existing Firefox search engine handles anything you type in the address bar.

## Features

- Choose your own start page; no website is configured by default.
- Open ordinary links in the full tab, including links initially marked to open a new window.
- Keep normal Ctrl-click, middle-click, download, and in-page anchor behavior.
- Open Glance dashboard group-heading links in the full tab.
- Restore standard tabs, expandable sections, and page/panel scroll positions when returning with Back.
- Store settings locally and request access only to the selected site.
- No accounts, analytics, or developer-operated backend.

## Install

Requires **desktop Firefox 140 or later**. Version 1.0.4 has not yet been signed
or published on Mozilla Add-ons. An unsigned ZIP cannot be installed permanently
in ordinary Firefox.

To try the source temporarily:

1. Download this repository using **Code → Download ZIP**, then extract it.
2. Open `about:debugging#/runtime/this-firefox` in Firefox.
3. Click **Load Temporary Add-on** and choose `extension/manifest.json`.
4. Open a new tab, click **Choose website**, enter your start page's address,
   and click **Save website**. Allow access to that site when Firefox asks.
5. Open another new tab to use it.

Use the settings button in the lower-right corner or the extension's toolbar
button to change the website. Temporary installation lasts until Firefox restarts.
Disable any other extension that overrides the new-tab page while using this one.

For permanent distribution, the extension must be signed by Mozilla. See
[publishing notes](PUBLISHING.txt).

## Website compatibility

The selected start page **must allow embedding in an iframe**. Sites that block
embedding remain blocked; this extension does not alter their security headers
or disable Firefox protections.

Ordinary HTML links, native forms, and Glance's active linked group headings are
handled. Other buttons implemented entirely with website JavaScript may behave
differently. Embedded login flows, cookies, popups, and autofocus can also differ
from a normal visit. If the start page redirects to a different hostname, save
the final address in settings.

When returning with Back or Forward, a page kept in Firefox's history cache is
reused without resetting its iframe. If Firefox reloads it, Tab & Type restores
the most recent supported controls and scroll positions saved for that browser
tab. Restoration uses standard page markup, with no Glance-specific selectors:

- ARIA tabs with a tablist, selected state, and a controlled tabpanel. Glance
  groups use this pattern and remain supported.
- Native HTML `details` sections, including their open or closed state.
- ARIA accordion/disclosure buttons that control a labelled `region`.
- Page and nested element scrolling, including horizontal right-to-left scrolling.

Unique element IDs keep controls identifiable when content moves. Controls
without IDs use their position and element type, so changed layouts can affect
restoration. Late controls are retried for up to five seconds; each control is
activated at most once per DOM element, and user input stops restoration.
Menus, dialogs, form entries, custom JavaScript state, and controls requiring
trusted input are not restored. Closed shadow roots and controls without the
supported markup are not covered. Anchor tabs that ignore canceled clicks may
not restore; native anchor navigation is suppressed to avoid extra history entries.

Temporary view state stays in memory while the extension is running and is
cleared when you close the tab, change the site, or revoke access. New tabs start
independently. This is best-effort restoration, not a copy of the entire app state.

## Development

The extension is plain HTML, CSS, and JavaScript, with no build step or runtime
dependencies. The installable files are in `extension/`.

For tests, use Node.js 22.22.2+, 24.15.0+, or 26+, and pnpm 11.25.0.
The only direct development dependency is jsdom; it is not packaged in the add-on.

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm test
```

To package the committed extension source with Git:

```sh
git -c core.autocrlf=false archive --format=zip --output=tab-and-type-1.0.4.zip HEAD:extension
```

The resulting ZIP has `manifest.json` at its root. It is still unsigned.

The 46 automated tests use mocked Firefox APIs and jsdom HTML fixtures. Link navigation
was also tested in a separate Firefox 159 profile with a Glance dashboard.
The Back/Forward restoration changes have automated regression coverage,
including multiple control patterns and changed markup. Scrolling and timing are
simulated; these changes have not yet been verified in a live Firefox session.
See [architecture and validation notes](docs/architecture.txt) for details.

## Privacy and permissions

The only required permission is `storage`. Optional site access lets the
extension handle links in the chosen start page. It does not request access to
bookmarks, passwords, clipboard contents, or browsing history.

The chosen website still makes its normal network requests and follows its own
privacy policy. Read the extension's [privacy policy](PRIVACY.txt).

## Contributing

Bug reports and pull requests are welcome at
[mcanning/Tab-Type](https://github.com/mcanning/Tab-Type/issues). Run the tests before submitting a
change. Include a public reproduction page or a minimal HTML example for
navigation bugs; do not include private dashboard addresses or credentials.

## License

[MIT](LICENSE), including the icon artwork. The internal extension ID is retained
from the original prototype so existing installations can update without losing
their saved website.
