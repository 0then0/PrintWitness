# Changelog

Notable user-facing changes are recorded here. Release dates use UTC. Published packages and checksums are available on [GitHub Releases](https://github.com/0then0/PrintWitness/releases).

## [Unreleased]

### Changed

- Added repository editor/Git conventions, community policies, issue forms and a pull request template.
- Refined CI permissions, action pinning, concurrency, artifact scope and desktop build triggers.

## [0.1.1] - 2026-10-24

### Fixed

- Retry macOS DMG creation up to three times for `Resource busy`, removing partial images and preserving failures for other errors.
- Exclude external lab fixtures from desktop distributions so separately licensed test materials are not shipped without their notices.
- Reject mismatched PDF/report identities before external lab verification or packaging overwrites existing outputs.

### Added

- An isolated, reproducible WeasyPrint #2469 case study with pinned revisions, frozen expectations and independent extraction, rendering and upstream regression checks. The buggy PDF remains `manual` because its section end boundary is missing; the fixed PDF is `found` against the same manifest.
- Regressions for DMG failures, changed or swapped PDFs, stale manifests and desktop fixture contents.

## [0.1.0] - 2026-10-24

### Added

- Local HTML and localhost source capture with CSS selectors, exclusions and bounded readiness.
- Frozen portable manifests and checks for required text, table records and link destinations in generated or existing PDFs.
- Separate found, mismatch, manual-review and unverifiable results with page previews and JSON/standalone HTML reports.
- Seven interface languages and system, light and dark themes.
- Standalone macOS arm64/x64, Windows x64 and Ubuntu 24.04 x64 packages with bundled Node.js and Chromium, native launchers and installer smoke tests.

[Unreleased]: https://github.com/0then0/PrintWitness/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/0then0/PrintWitness/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/0then0/PrintWitness/releases/tag/v0.1.0
