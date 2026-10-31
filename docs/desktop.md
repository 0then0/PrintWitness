# Standalone PrintWitness

The standalone distribution includes Node.js, Playwright, Chromium Headless Shell, PDF.js and the built interface. Users do not need Git, Node.js, npm or a separate browser-engine download. The interface opens in the default browser; HTML capture and PDF creation use the bundled Chromium engine.

## Install or run a portable copy

- **macOS 14 or newer, Apple Silicon or Intel:** open the `.dmg` and drag PrintWitness to Applications. Alternatively extract the `.zip` and open `PrintWitness.app` directly.
- **Windows 10/11 x64:** run the `-setup.exe` installer, or extract the portable `.zip` and open `PrintWitness.exe`. Keep the entire extracted folder together. The installer is per-user and does not require administrator privileges.
- **Ubuntu 24.04 x64:** install the `.deb` through the package manager, or extract the `.tar.gz` and run the `PrintWitness` executable. The portable archive still requires Chromium's system libraries, fonts and `xdg-open`. The `.deb` declares those dependencies. A Linux archive is not a universal binary for every distribution.

Open the app with its launcher or installed shortcut. It starts a loopback-only server and opens the workspace in the default browser. No terminal window is needed on macOS or Windows. A second launch opens the running instance. Closing a browser tab does not stop the server: use **Quit PrintWitness** at the bottom of the workspace after exporting results. The confirmation reminds you that documents retained in memory will be cleared.

The installer and portable archive contain the same prepared application. No account, cloud service, telemetry or automatic update service is added. Replace the application to update it; quit the running copy first. The source checkout and development commands remain available to contributors.

## Permissions and local state

Installation files can be read-only. Chromium uses a disposable system temporary profile. Startup state, the remembered port and startup diagnostics are stored separately:
- macOS: `~/Library/Application Support/PrintWitness/`
- Windows: `%LOCALAPPDATA%\PrintWitness\`
- Linux: `$XDG_STATE_HOME/PrintWitness/`, or `~/.local/state/PrintWitness/`

This state directory contains no retained PDF or report database. Reports stay in process memory until explicitly exported. Language and theme preferences remain in the browser's local storage for the app's loopback origin. If its remembered port becomes occupied by another application, PrintWitness chooses another port; browser preferences for the old origin do not transfer automatically.

Check `launcher.log` if startup fails. A stale lock from a terminated process is recovered on the next launch. A corrupt lock left during an interrupted startup is recoverable after 30 seconds. A running instance is identified by both its process and an instance identifier, rather than trusting any service on port 4173.

Local builds are unsigned. Downloaded unsigned macOS or Windows applications can trigger operating-system security checks. The packaging pipeline does not bypass these checks. Signing and macOS notarization require the publisher's credentials and must be completed before presenting downloads as signed releases.

## Build distributions

Use a native build machine for each target, Node.js 24.13 or newer and the committed lockfile:

```sh
npm ci
npm run desktop:build
```

The builder downloads an official Node.js runtime pinned in `package.json`, verifies its archive against the official SHA-256 manifest, installs production dependencies and obtains the Playwright-compatible Chromium Headless Shell. Downloads and generated output remain under the ignored `artifacts/` directory. It does not use the build machine's Node executable as the shipped runtime.

macOS packaging uses the system `sips`, `iconutil`, `ditto` and `hdiutil` tools. Windows packaging uses the .NET Framework C# compiler and NSIS (`NSIS_EXE` can specify `makensis.exe`). Ubuntu packaging requires `tar`, `dpkg-deb` and Chromium system dependencies. On Linux install those build dependencies with `npm run browsers -- --with-deps --only-shell` before building. Builder prerequisites are not commands end users must run.

DMG creation retries the specific `hdiutil` error `Resource busy` up to three attempts, removing partial images between attempts and on failure. Other errors fail immediately. Persistent failures still fail the build. The desktop payload includes only the original `fixtures/validation.html`; external lab fixtures and their separate licensing remain in the source repository.

Outputs are written to `artifacts/desktop/<platform>-<architecture>/bundles/` with SHA-256 checksums. The `desktop` workflow builds native targets and retains artifacts without publishing a GitHub release. Its matrix covers macOS arm64/x64, Windows x64 and Ubuntu 24.04 x64.

The pipeline stages can also run separately:

```sh
npm run desktop:prepare
npm run desktop:bundle
npm run desktop:test
```

Preparation preserves the source directory layout so Node can execute the existing server-side TypeScript. PDF.js assets and native canvas dependencies are included. The builder creates platform launchers and packages that same prepared payload into portable and installation formats.

## Validation

`desktop:test` extracts the actual portable archive, launches it from a path containing spaces and Unicode with no Node.js or npm on `PATH`, and verifies capture, printing, existing-PDF checks and native page previews. The broken fixture must report six mismatches; the fixed fixture must find all 109 expectations. It also checks read-only installation files, a foreign service on the preferred port, stale-state recovery, duplicate launch, confirmation/cancellation of UI shutdown and reuse of the remembered port.

The installer payload is mounted read-only on macOS, installed/uninstalled silently on Windows, or extracted from the Debian package on Linux, then launched and stopped. These tests use disposable state directories under `artifacts/`. They do not certify code signing, notarization or compatibility with every machine. The normal `npm run check` remains the source-level validation command.

### PDF.js resources in v0.1.2

The application resolves resources relative to the imported `pdfjs-dist/legacy/build/pdf.mjs`, using Node's package resolution rather than a path from the working directory. The pinned 6.4.299 metadata has no `exports` restriction; the resolver uses the same supported entry point as the existing import and does not assume private subpaths such as `package.json` are exported. File URLs preserve spaces, Unicode and Windows drive paths; resource reads use Node's filesystem API. No parent `node_modules`, global dependency or CDN is required.

This version uses `BinaryDataFactory`, not the factories from older PDF.js examples. CMaps and standard fonts are read on demand with `useWorkerFetch: false` and `useSystemFonts: false`. JPX/JBIG2 decoders request `wasm/openjpeg.wasm` and `wasm/jbig2.wasm` through that factory and can import their adjacent JavaScript fallbacks using a file URL. All upstream WASM files, JS fallbacks and license notices remain in the payload. The QCMS/ICC path is disabled by PDF.js when `useWorkerFetch` is false; QuickJS belongs to the scripting sandbox, which PrintWitness does not instantiate. Neither is advertised as a tested decoding feature. Their files and `iccs/` are retained unchanged.

The smoke test compares every shipped file in `cmaps/`, `standard_fonts/`, `wasm/` and `iccs/` with the prepared payload, then submits the external predefined-CMap fixture through the relocated application's `/api/check`. It asserts 日本語 and `found`. A second pass uses the packaged modules and runtime with outgoing TCP and `fetch` forbidden, asserts dependency resolution remains inside the package and reads the shipped decoder binaries and JS fallbacks. Its cwd is outside the checkout's source directory, `PATH` is empty, and `NODE_PATH`/`NODE_OPTIONS` are removed. The normal launcher/browser tests remain in place. Decoder-file reads establish delivery, not successful decoding of every image format.
