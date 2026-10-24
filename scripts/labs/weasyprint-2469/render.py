"""Offline execution in the disposable lab image, never in the user's Python."""

import ast
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path('/repo/artifacts/weasyprint-2469')
LAB = Path('/repo/scripts/labs/weasyprint-2469')
ADAPTED = Path('/repo/fixtures/weasyprint-2469/adapted.html')
REVISIONS = {
    'parent': '8ace950151b4fdf380721e06f3ff65af9a464158',
    'fix': '8415e28a6269144cbc28e20c4b22d2d85e3b6d0e',
}


def output(*args, **kwargs):
    return subprocess.check_output(args, text=True, **kwargs).strip()


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


if len(sys.argv) > 1:
    # One separate process per revision prevents Python module-cache contamination.
    revision = sys.argv[1]
    source = ROOT / 'work' / f'WeasyPrint-{REVISIONS[revision]}'
    sys.path.insert(0, str(source))
    import weasyprint
    from weasyprint import CSS, HTML

    assert Path(weasyprint.__file__).is_relative_to(source)
    (ROOT / f'{revision}-renderer.json').write_text(json.dumps({
        'version': weasyprint.__version__, 'module_file': weasyprint.__file__,
        'flex_sha256': digest(source / 'weasyprint/layout/flex.py'),
    }, indent=2) + '\n')
    observations = {}
    for case, path in [('upstream', ROOT / 'work/upstream.html'), ('adapted', ADAPTED)]:
        for control, css in [('', None), ('-no-flex', 'body { display: block !important }'),
                             ('-no-break', '#break-after { break-after: auto !important }')]:
            name = f'{revision}-{case}{control}'
            # Unchanged HTML; control overrides are separate stylesheets.
            doc = HTML(filename=str(path)).render(
                stylesheets=[CSS(string=css)] if css else None,
                presentational_hints=False,
            )
            doc.write_pdf(ROOT / f'{name}.pdf', zoom=1)
            texts = []
            for page in doc.pages:
                texts.append([box.text for box in page._page_box.descendants() if hasattr(box, 'text')])
            observations[name] = texts
            subprocess.run(['pdftotext', '-layout', '-enc', 'UTF-8', str(ROOT / f'{name}.pdf'),
                            str(ROOT / f'{name}.txt')], check=True)
            if not control:
                subprocess.run(['pdftoppm', '-r', '90', '-png', str(ROOT / f'{name}.pdf'),
                                str(ROOT / 'previews' / name)], check=True)
    (ROOT / f'{revision}-layout.json').write_text(json.dumps(observations, indent=2) + '\n')
    print(revision, weasyprint.__version__, observations)
    sys.exit(0)

# Baseline must exist before any renderer starts. No expectation comes from a PDF.
frozen = (ROOT / 'manifest.json').read_bytes()
assert hashlib.sha256(frozen).hexdigest() == (ROOT / 'manifest.sha256').read_text().strip()
upstream_expectations = {'source': 'issuecomment-4060916782', 'required_text': ['B', 'C']}
(ROOT / 'upstream-expectations.json').write_text(json.dumps(upstream_expectations, indent=2) + '\n')
(ROOT / 'previews').mkdir(exist_ok=True)

fixed = ROOT / 'work' / f"WeasyPrint-{REVISIONS['fix']}"
test_file = fixed / 'tests/layout/test_flex.py'
module = ast.parse(test_file.read_text())
node = next(n for n in module.body if isinstance(n, ast.FunctionDef) and n.name == 'test_flex_break_after_page')
lines = test_file.read_text().splitlines(keepends=True)
regression = ''.join(lines[node.decorator_list[0].lineno - 1:node.end_lineno])
test = 'from ..testing_utils import assert_no_logs, render_pages\n\n\n' + regression
regressions = {}
for revision, sha in REVISIONS.items():
    source = ROOT / 'work' / f'WeasyPrint-{sha}'
    # Transplant the exact regression into both test trees; renderer files stay unchanged.
    target = source / 'tests/layout/test_2469_external.py'
    target.write_text(test)
    result = subprocess.run([sys.executable, '-m', 'pytest', '-q', str(target)], cwd=source,
                            text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    (ROOT / f'{revision}-upstream-regression.txt').write_text(result.stdout)
    regressions[revision] = {'exit_code': result.returncode, 'test_sha256': digest(target)}
    subprocess.run([sys.executable, __file__, revision], check=True)

metadata = {
    'revisions': REVISIONS,
    'weasyprint': {revision: json.loads((ROOT / f'{revision}-renderer.json').read_text())
                  for revision in REVISIONS},
    'renderer_sha256': {revision: digest(ROOT / 'work' / f'WeasyPrint-{sha}' / 'weasyprint/layout/flex.py')
                        for revision, sha in REVISIONS.items()},
    'python': sys.version,
    'platform': output('uname', '-a'),
    'pip_freeze': output(sys.executable, '-m', 'pip', 'freeze').splitlines(),
    'debian_packages': output('dpkg-query', '-W', '-f=${Package}=${Version}\n').splitlines(),
    'fonts': output('fc-list', '--format', '%{file}: %{family}: %{style}\n').splitlines(),
    'font_hashes': {str(p): digest(p) for p in Path('/usr/share/fonts').rglob('*.ttf')},
    'default_serif': output('fc-match', 'serif'),
    'default_sans': output('fc-match', 'DejaVu Sans'),
    'generation': {'media': 'print', 'zoom': 1, 'presentational_hints': False, 'other_options': 'WeasyPrint defaults'},
    'poppler': subprocess.run(['pdftoppm', '-v'], text=True, capture_output=True).stderr.strip(),
    'upstream_regression': regressions,
    'inputs_sha256': {'upstream.html': digest(ROOT / 'work/upstream.html'),
                      'adapted.html': digest(ADAPTED),
                      'manifest.json': hashlib.sha256(frozen).hexdigest()},
}
(ROOT / 'environment.json').write_text(json.dumps(metadata, indent=2) + '\n')
for package in ['fonts-dejavu-core', 'fontconfig', 'poppler-utils']:
    (ROOT / f'{package}-copyright.txt').write_bytes((Path('/usr/share/doc') / package / 'copyright').read_bytes())
assert (ROOT / 'manifest.json').read_bytes() == frozen

# Also invoke the original test at its upstream path, without transplantation.
result = subprocess.run([sys.executable, '-m', 'pytest', '-q',
                         'tests/layout/test_flex.py::test_flex_break_after_page'],
                        cwd=fixed, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
(ROOT / 'fix-original-regression.txt').write_text(result.stdout)
assert result.returncode == 0, result.stdout
