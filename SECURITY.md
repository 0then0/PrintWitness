# Security model

PrintWitness v0.1 is intended for one user on a local machine. It is not a shared document-processing service. Run it with trusted local HTML and PDFs and keep dependencies current.

## Local processing boundary

The HTTP server binds to `127.0.0.1`, validates Host and Origin, and requires a custom header for JSON mutations. It retains at most three checked documents in volatile memory. Source paths are supplied by the local user; imported manifests do not execute paths or scripts.

HTML source scripts execute in a disposable Chromium context so dynamic pages can become ready. HTTP(S) source resources are restricted to the original loopback origin and GET/HEAD methods. Cross-origin redirects, third-party requests and WebSockets are blocked. Service workers and downloads are disabled. WebRTC peer connection APIs are disabled before source scripts run in each frame because ICE/STUN/TURN traffic bypasses HTTP routing.

Local files are served through an intercepted synthetic origin. Only assets within the source file's directory are readable, including after symlink resolution. The original HTML and its assets are not rewritten. Source markup is never inserted into the application UI or HTML report.

These controls support local processing; they do not make Chromium or the operating system a security sandbox for hostile documents. Source scripts can still read approved same-origin resources and perform local computation. Do not expose the application through a reverse proxy or public network interface.

## Standalone distribution

The standalone launcher preserves the same loopback, source-isolation and PDF verification boundaries. It bundles the official Node.js runtime, production dependencies and the Playwright-compatible Chromium engine. Builds verify the Node archive against the official SHA-256 manifest and retain component licenses. A native package is not an additional sandbox for hostile source scripts.

The launcher keeps an instance lock, remembered port and startup log in the current user's application-state directory. Installation resources are not writable runtime storage. Desktop shutdown uses the existing same-origin/custom-header checks and is unavailable in ordinary source-server mode. Unsigned developer builds are not signed or notarized releases; publishers must supply appropriate signing credentials separately.

## Reports and limits

Manifests and reports contain document text, URLs, hashes and evidence. Standalone HTML reports also embed rendered pages and use an inline script for highlighting. Their content security policy prohibits network resources. Exported files are not encrypted or redacted.

PDF uploads are limited to 25 MiB and 100 pages. Capture is limited to 100 selected sections and 10,000 expectations. Preview rendering is limited to two million pixels per page. Complex documents can still consume significant resources.

A found result establishes text-layer presence within matching limits, not visibility, accessibility, authenticity or compliance. See the [matching reference](docs/matching.md).

## Reporting a vulnerability

Use the repository's [private vulnerability reporting form](https://github.com/0then0/PrintWitness/security/advisories/new) when available. If private reporting is unavailable, ask for a private contact channel in an issue without disclosing exploit details or private document content. Include the affected revision, environment and a minimal synthetic reproducer.

Dependency updates are reviewed through Dependabot. Scheduled version-update groups do not include security updates; repository administrators should keep Dependabot alerts and security updates enabled. There is no automatic merge policy.
