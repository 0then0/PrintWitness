# Usage guide

## Choose a source

Enter an absolute `.html` or `.htm` path, a `file:` URL, or an HTTP(S) URL on `localhost`, `127.0.0.1` or `[::1]`. Local file assets must remain inside the HTML file's directory, including resolved symlink targets. Localhost pages can load resources only from their own origin.

PrintWitness executes source scripts to capture dynamic content. It reads the source without changing it. Remote fonts, CDNs and data services are unavailable during capture and printing; provide local copies.

## Select required content

Enter one CSS selector per line. Every matched element becomes a section. Select disjoint elements: a section and its descendant table cannot both be selected.

A selected element needs an `h1`–`h6` heading inside it or preceding it. Prefer a containing section with its own unique heading. A table can be selected directly when it is the only table under that heading. If several tables share a heading, select their containing section or give each table a separate heading.

Text blocks become individual expectations. Table rows retain their ordered cell values. Table headers are required once; repeated printed header copies cannot replenish missing body records. Links retain both their labels and destinations.

## Wait for dynamic content

Choose one readiness mode:
- **DOM and fonts:** wait for DOM content and loaded fonts. This does not establish that asynchronous data is complete.
- **CSS selector:** wait for a matching element to be attached. Choose a selector that appears only after all required data has arrived.
- **Global signal:** wait for a named window property to equal `true`, for example `window.PRINTWITNESS_READY = true`.

The timeout must be between 100 and 60,000 ms. The readiness deadline covers navigation, the selected condition and fonts. PDF export has its own bounded timeout. Capture and printing each reload the source and wait independently.

## Freeze expectations and exclusions

Specify intentional CSS exclusions before capture. Contextual selectors such as `#required .screen-note` are supported. Exclusions are evaluated in the original DOM context. Hidden DOM text is otherwise still expected.

Click **Freeze manifest**, then inspect the checklist. Before checking, an individual expectation can also be excluded with an explicit reason. Exclusions remain in the manifest and report and never count as successes.

Download the manifest to reuse it independently of the source. Importing a manifest validates its structure without executing source scripts or opening paths from that manifest. An older manifest without DOM boundary context remains readable, but cannot establish a positive section match; capture a new manifest for current matching.

## Check and inspect

**Create PDF** reloads the current source with print media and compares the export with the frozen manifest. Changes since capture are compared to that original baseline. **Check PDF** compares an uploaded PDF with the same expectations and needs no source access.

Select a check to see its expected text, explanation, URL details and available evidence. Evidence highlights extraction-item coordinates, which can cover more than the precise matching characters. Navigate pages independently of the selection. Use the status filter and search to inspect losses or uncertain results.

The four result states are:
- **Found in text layer:** an independent occurrence exists in established section context. Links additionally need a uniquely associated matching URL annotation. Visual integrity is unproven.
- **Mismatch:** required content is absent in established context, an independent repetition is missing, or a uniquely associated URL differs.
- **Manual review:** section context, cell geometry, reading order or link association is ambiguous. Missing text in a PDF with an empty-text page also requires inspection.
- **Unverifiable:** no usable text layer, unreadable or unsupported PDF, or no active expectations.

The overall result prioritizes mismatch, then unverifiable, then manual review, then found. An entirely excluded manifest is unverifiable.

## Export results

Download the checked PDF, JSON report or standalone HTML report. HTML exports include raster page previews, coordinate highlights and translated explanations, with no external assets. Select a finding to highlight its evidence. JSON preserves stable status values and English diagnostics for automation.

The local server retains at most three checked documents in memory. Restarting clears them. Export results explicitly if you need to keep them. Exports include expected text, page text, URLs and hashes; they are not redacted.

## External PDF runtime resources

PDF.js reads CMaps, standard fonts and image decoder data from the installed application, without CDN access. Some PDFs require a predefined CMap to interpret their text. Version 0.1.2 checks this path with a synthetic horizontal `UniJIS-UCS2-H` document containing 日本語; this is not a claim of complete CJK or arbitrary PDF support.

At module initialization the application resolves the same installed PDF.js entry point used for extraction. It does not require every optional resource to be readable before accepting any document. During processing, the local `BinaryDataFactory` reads requested CMaps, standard-font data and WASM. A failed or empty resource read is retained even when PDF.js catches the error and continues. The report then says **PDF runtime resource unavailable**, identifies the requested resource and marks active checks **Unverifiable**, including when some text survived. Reinstall the complete application rather than treating this as evidence of missing PDF content. Unused missing resources do not fail unrelated PDFs.

A PDF with no extracted text and no detected processing failure is reported separately as having no usable text layer; OCR remains outside v0.1. Parsing/extraction failures are reported as unreadable or unsupported PDFs. Preview failures have page warnings. This does not detect every recovery or warning inside PDF.js: its API provides no complete processing-success contract, and decoder JavaScript fallback imports are outside `BinaryDataFactory`. A successful text comparison still does not prove visible content, absence of clipping/overlap, correct glyph appearance or PDF accessibility. Rotated and vertical text still require manual inspection.
