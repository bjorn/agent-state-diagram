# Licenses and dependency integrity

Authored scripts and UI are covered by the skill's [MIT license](../LICENSE).
No third-party bundle, font or cache is committed.

- **Mermaid 12.3.0**, MIT:
  [source/license](https://github.com/mermaid-js/mermaid/tree/mermaid%4012.3.0).
  `viewer.py setup` verifies the exact JS and LICENSE hashes and keeps
  `Mermaid-LICENSE` in the private runtime directory. The distribution's
  embedded notices are unchanged. No separate font or icon assets are copied.

Versions, URLs and checksum pins have one authority: `PINS` in `viewer.py`.
Hash checks are integrity checks against those pins, not an independent
signature audit or a certification of every transitive dependency. Review
upstream notices before redistributing fetched dependencies; they are not
relicensed by this package.
