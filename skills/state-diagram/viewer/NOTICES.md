# Licenses and dependency integrity

Authored scripts, UI and tests are covered by the skill's [MIT license](../LICENSE).
No third-party binary, minified bundle, browser, font or cache is committed.

- **Zola 0.23.6**, MIT:
  [source/license](https://github.com/getzola/zola/tree/v0.23.6).
  Setup obtains the official Linux x86_64 musl release only after explicit
  consent, verifies the pinned archive SHA-256, then verifies the regular binary
  member separately. Offline copies must match the same binary pin.
- **Mermaid 12.3.0**, MIT:
  [source/license](https://github.com/mermaid-js/mermaid/tree/mermaid%4012.3.0).
  Setup verifies exact JS and LICENSE hashes and retains `Mermaid-LICENSE` in
  the private project cache. The distribution's embedded notices are unchanged.
  No separate font or icon assets are copied.
- **Puppeteer/Chromium**, optional development tools, are supplied separately
  under their upstream licenses (Apache-2.0 for Puppeteer; Chromium's component
  licenses apply). Tests use an explicitly installed module or existing cache;
  they never install or download a browser.

Versions, URLs and checksum pins have one authority: `common.py`. Hash checks
are integrity checks against those pins, not an independent signature audit or
a certification of every transitive dependency. Review upstream notices before
redistributing fetched dependencies; they are not relicensed by this package.
