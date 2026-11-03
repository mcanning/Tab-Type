<p align="center">
  <img src="extension/icons/icon-128.png" width="96" height="96" alt="Tab & Type icon">
</p>

# Tab & Type

**Your page, ready to search.**

**Tried a new-tab add-on that opens your favorite page, but makes you click the
address bar before you can search?**

Tab & Type is for you. It shows your chosen website on every new tab while
keeping Firefox's address bar empty and ready for typing. Open a tab, start
typing, and search with your existing default search engine.

## Features

- Choose your own start page and keep the new-tab address bar ready to search.
- Open ordinary links in the full tab, including links initially marked to open a new window.
- Keep normal Ctrl-click, middle-click, download, and in-page anchor behavior.
- Store settings locally and request access only to the selected site.
- No accounts, analytics, or developer-operated backend.

## Glance dashboards

Using [Glance](https://github.com/glanceapp/glance), the self-hosted dashboard
app? Tab & Type also helps you return to your place after following a link:

- Restore your selected dashboard groups and page/panel scroll positions.
- Remember expanded "Show more" lists and card grids, including sections in
  inactive groups.
- Reopen expanded sections before restoring the scroll position. "Show less"
  still works, and sections you closed stay closed.
- Open linked group headings in the same browser tab.

Group and expanded-section restoration currently support Glance dashboards.
Back or Forward can still reload the page before its saved view is restored;
changed dashboard layouts and feed contents can affect restoration.

## Install

Requires **desktop Firefox 140 or later**. Version 1.0.5 has not yet been signed
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

Version 1.0.5 returns to the Glance-specific restoration used in 1.0.3 and adds
"Show more" support. Returning with Back or Forward can still reload the page;
the extension restores saved view state afterward. This is not native page caching.

- Glance's selected dashboard groups.
- Glance's expanded or collapsed "Show more" lists and card grids, including
  sections inside inactive groups. The native button updates its own state and
  label, so "Show less" still works after restoration.
- Page and nested element scroll positions, applied after groups and sections.

Controls are located by their position in the document, as in 1.0.3. Changed
layouts or feed structure can affect restoration. Late controls are retried for
up to five seconds; user input stops restoration. An expansion toggle is clicked
at most once per DOM element and only when its current state differs from the
saved state. The generic ARIA tab, details and accordion handling from 1.0.4 has
been removed. Other sites still support the original new-tab/link behavior, but
their custom controls and application state are not restored.

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
git -c core.autocrlf=false archive --format=zip --output=tab-and-type-1.0.5.zip HEAD:extension
```

The resulting ZIP has `manifest.json` at its root. It is still unsigned.

The 38 automated tests use mocked Firefox APIs and jsdom HTML fixtures. Link navigation
was also tested in a separate Firefox 159 profile with a Glance dashboard.
The Back/Forward restoration changes have automated regression coverage,
including Glance groups, Show more/less, delayed widgets and unsafe controls. Scrolling and timing are
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
