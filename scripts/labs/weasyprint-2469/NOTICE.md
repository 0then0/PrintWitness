# Attribution and export policy

`fixtures/weasyprint-2469/adapted.html` is an adaptation of `test_flex_break_after_page` in
[WeasyPrint's fixed revision](https://github.com/Kozea/WeasyPrint/blob/8415e28a6269144cbc28e20c4b22d2d85e3b6d0e/tests/layout/test_flex.py#L2006).
Copyright (c) 2011-2021, Simon Sapin and contributors. The test, adapted HTML
and its derived textual artifacts are distributed under BSD-3-Clause;
retain [LICENSE.WeasyPrint](LICENSE.WeasyPrint). The changes introduce readable
markers, A4 sizing, a heading and an end-context heading. The lab's other original
code and documentation use PrintWitness's Apache-2.0 license.

The minimal issue example is by GitHub user **septatrix**, posted on March 14,
2026 in [comment 4060916782](https://github.com/Kozea/WeasyPrint/issues/2469#issuecomment-4060916782).
No explicit reusable license for that comment was found. The lab downloads it
for local reproduction; the example, its PDFs, extracted text and previews are
excluded from the share bundle. Public accessibility is not treated as a license
grant. Attachments from the original large example are not used or redistributed.

The adapted PDFs embed subsets of DejaVu Sans. DejaVu changes are public domain;
the underlying Bitstream Vera notice permits reproduction and distribution,
subject to its notice and naming conditions. Keep [LICENSE.DejaVu](LICENSE.DejaVu)
with PDFs and previews. No standalone font files are exported. The lab image also
uses DejaVu Serif for the unchanged upstream example; full package copyright
records are saved locally. WeasyPrint's test-only font is used by its regression
test, not by the exported PDFs.

Poppler is an independent local extraction/rendering tool; its binaries, Docker
image and native libraries are not included in the share bundle. The bundle
contains original document outputs, reports, metadata, adapted previews and
the required notices. It excludes downloaded source trees, issue-derived
artifacts, caches and the image. Do not publish the entire ignored lab directory.

This case study does not imply endorsement, adoption or use of PrintWitness by
WeasyPrint's authors or issue participants.
