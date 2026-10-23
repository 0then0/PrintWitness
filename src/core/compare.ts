import { normalize } from './normalize.ts';
import type { Evidence, Finding, Manifest, PdfIndex, Report, Status } from './types.ts';

interface Span {
  start: number;
  end: number;
  token: number;
}
interface Match {
  start: number;
  end: number;
}

export function compare(
  manifest: Manifest,
  pdf: PdfIndex,
  identity: { name: string; sha256: string },
): Report {
  let text = '';
  const spans: Span[] = [];
  pdf.tokens.forEach((token, i) => {
    const previous = pdf.tokens[i - 1];
    const sameLine =
      previous && previous.page === token.page && Math.abs(previous.box.y - token.box.y) < 2;
    const adjacent =
      sameLine &&
      token.box.x - previous.box.x - previous.box.width < Math.max(1, token.box.height * 0.12);
    if (text && (!adjacent || /\s$/u.test(previous.text) || /^\s/u.test(token.text)))
      text += sameLine ? ' ' : '\n';
    const start = text.length;
    text += normalize(token.text);
    spans.push({ start, end: text.length, token: i });
  });
  // Keep an offset map back to the original stream when removing line-end hyphenation.
  const cjk =
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-\u303f\uff00-\uffef]/u;
  const variants = ['normal', 'dehyphenate', 'cjk'].map((mode) => {
    let value = '';
    const offsets: number[] = [];
    for (let i = 0; i < text.length; i++) {
      if (
        mode === 'dehyphenate' &&
        text[i] === '-' &&
        text[i + 1] === '\n' &&
        /\p{L}/u.test(text[i - 1] ?? '') &&
        /\p{Ll}/u.test(text[i + 2] ?? '')
      ) {
        i++;
        continue;
      }
      if (
        mode === 'cjk' &&
        text[i] === '\n' &&
        cjk.test(text[i - 1] ?? '') &&
        cjk.test(text[i + 1] ?? '')
      )
        continue;
      const char = /\s/u.test(text[i]) ? ' ' : text[i];
      if (char === ' ' && value.endsWith(' ')) continue;
      value += char;
      offsets.push(i);
    }
    return { value, offsets };
  });
  const cache = new Map<string, Match[]>();
  const find = (expected: string): Match[] => {
    const needle = normalize(expected);
    if (!needle) return [];
    const cached = cache.get(needle);
    if (cached) return cached;
    const matches = new Map<string, Match>();
    for (const { value, offsets } of variants) {
      let from = 0;
      while (from < value.length) {
        const at = value.indexOf(needle, from);
        if (at < 0) break;
        const end = at + needle.length;
        // A number/word must not be satisfied by a substring of a different record.
        const word = (s: string | undefined) => !!s && !cjk.test(s) && /[\p{L}\p{N}_]/u.test(s);
        if (
          !(word(needle[0]) && word(value[at - 1])) &&
          !(word(needle.at(-1)) && word(value[end]))
        ) {
          const m = { start: offsets[at], end: offsets[end - 1] + 1 };
          matches.set(`${m.start}:${m.end}`, m);
        }
        from = at + Math.max(1, needle.length);
      }
    }
    const found = [...matches.values()].sort((a, b) => a.start - b.start);
    cache.set(needle, found);
    return found;
  };
  const evidence = (m: Match): Evidence[] =>
    spans
      .filter((s) => s.end > m.start && s.start < m.end)
      .map((s) => {
        const t = pdf.tokens[s.token];
        return { page: t.page, box: t.box, text: t.text };
      });
  const findAnchor = (label: string) =>
    find(label).filter((m) => {
      const start = text.lastIndexOf('\n', m.start - 1) + 1;
      const newline = text.indexOf('\n', m.end);
      return normalize(text.slice(start, newline < 0 ? text.length : newline)) === normalize(label);
    });
  const findings: Finding[] = [];
  const usedLinks = new Set<number>();
  // A hidden selected section may remove the preceding section's end anchor too.
  // Skip that boundary only if none of that section's expected content survives
  // before the next established boundary. Otherwise widening would mix contexts.
  const endBoundary = (
    label: string | null,
    from: number,
    visited = new Set<string>(),
  ): number | undefined => {
    if (!label) return text.length;
    const hits = findAnchor(label);
    if (hits.length === 1) return hits[0].start;
    if (hits.length || visited.has(label)) return undefined;
    visited.add(label);
    const missing = manifest.sections.find((s) => s.anchor === label);
    if (!missing) return undefined;
    const end = endBoundary(missing.endContext ?? missing.after, from, visited);
    if (
      end === undefined ||
      missing.expectations.some(
        (e) => !e.excluded && find(e.text).some((m) => m.start >= from && m.end <= end),
      )
    )
      return undefined;
    return end;
  };
  for (const section of manifest.sections) {
    const anchors = findAnchor(section.anchor);
    const before = section.before ? findAnchor(section.before) : [];
    const after = section.endContext ? findAnchor(section.endContext) : [];
    let low = 0,
      high = text.length,
      certain = false;
    const end =
      anchors.length === 1 && section.endContext !== undefined
        ? endBoundary(section.endContext, anchors[0].end)
        : undefined;
    if (anchors.length === 1 && end !== undefined) {
      low = anchors[0].start;
      high = end;
      certain = low < high && (!before.length || before[0].end <= low);
    } else if (
      !anchors.length &&
      before.length === 1 &&
      after.length === 1 &&
      before[0].end < after[0].start
    ) {
      low = before[0].end;
      high = after[0].start;
      certain = section.startContext !== undefined;
    }
    if (certain && section.startContext) {
      const starts = find(section.startContext);
      const established = starts.length === 1 && starts[0].end <= high;
      if (established) low = Math.max(low, starts[0].end);
      else if (!anchors.length || !section.anchorInside) certain = false;
    }
    const used: Match[] = [];
    const usedLinkLabels: Match[] = [];
    for (const expected of section.expectations) {
      const f: Finding = {
        id: expected.id,
        sectionId: section.id,
        section: section.title,
        kind: expected.kind,
        expected: expected.text,
        href: expected.href,
        status: 'unverifiable',
        reason: '',
        evidence: [],
        excluded: expected.excluded,
      };
      findings.push(f);
      if (expected.excluded) {
        f.reason = `Explicitly excluded: ${expected.excluded}`;
        continue;
      }
      if (pdf.error || !normalize(text)) {
        f.reason = pdf.error ?? 'No usable text layer. OCR is outside v0.1.';
        continue;
      }
      if (
        manifest.sections.filter((s) => normalize(s.anchor) === normalize(section.anchor)).length >
        1
      ) {
        f.status = 'manual';
        f.reason =
          'Multiple selected sections share the same anchor. One PDF occurrence cannot establish which section survived.';
        continue;
      }
      if (!certain) {
        f.status = 'manual';
        f.reason =
          'Section boundaries are missing, repeated, or out of order. A match elsewhere cannot establish preservation.';
        continue;
      }
      const headers = section.headers.filter((h) => normalize(h) === normalize(expected.text));
      if (headers.length && (expected.role !== 'table-header' || headers.length > 1)) {
        f.status = 'manual';
        f.reason =
          'This expectation is indistinguishable from a repeating table header. Header copies cannot establish preservation of a separate record or text.';
        continue;
      }
      const candidates = find(expected.text).filter((m) => m.start >= low && m.end <= high);
      // Link labels may overlap text/rows; each link annotation is consumed separately.
      const consumed = expected.kind === 'link' ? usedLinkLabels : used;
      const m = candidates.find((m) => !consumed.some((u) => m.start < u.end && m.end > u.start));
      if (!m) {
        if (
          !candidates.length &&
          expected.kind === 'row' &&
          expected.cells?.every((cell) =>
            find(cell).some((hit) => hit.start >= low && hit.end <= high),
          )
        ) {
          f.status = 'manual';
          f.reason =
            'Cell values exist in this section, but do not form a complete ordered row. Reading order or row association requires manual inspection.';
          f.evidence = expected.cells.flatMap((cell) => {
            const hit = find(cell).find((hit) => hit.start >= low && hit.end <= high);
            return hit ? evidence(hit) : [];
          });
          continue;
        }
        const emptyPage = pdf.pages.some((p) => !normalize(p.text));
        f.status = emptyPage ? 'manual' : 'mismatch';
        f.reason = emptyPage
          ? 'Expected text is absent, but a page has no text layer. Inspect that page manually.'
          : candidates.length
            ? 'Not enough independent occurrences inside this section.'
            : 'Expected text/row is absent inside the established section boundaries.';
        continue;
      }
      f.evidence = evidence(m);
      if (expected.kind !== 'link') used.push(m);
      if (expected.kind === 'row') {
        // Cell boundaries must coincide with complete extraction items. Flattening
        // cells would accept ["A B", "C"] in place of ["A", "B C"].
        let offset = m.start;
        let cellsCertain = true;
        let previousCell: Evidence | undefined;
        for (const cell of expected.cells ?? []) {
          const value = normalize(cell);
          if (!value) {
            cellsCertain = false;
            break;
          }
          const hit = find(cell).find((h) => h.start >= offset && h.end <= m.end);
          if (
            !hit ||
            spans.some(
              (s) =>
                (s.start < hit.start && s.end > hit.start) ||
                (s.start < hit.end && s.end > hit.end),
            )
          ) {
            cellsCertain = false;
            break;
          }
          const items = evidence(hit);
          const first = items[0];
          const last = items.at(-1);
          const gapLimit = Math.max(3, (first?.box.height ?? 10) * 0.5);
          if (
            !first ||
            !last ||
            (previousCell &&
              (previousCell.page !== first.page ||
                first.box.x - previousCell.box.x - previousCell.box.width <= gapLimit)) ||
            items.some(
              (item, i) =>
                i > 0 && item.box.x - items[i - 1].box.x - items[i - 1].box.width > gapLimit,
            )
          ) {
            cellsCertain = false;
            break;
          }
          previousCell = last;
          offset = hit.end;
        }
        if (!cellsCertain) {
          f.status = 'manual';
          f.reason =
            'Cell values exist in this section, but do not form a complete ordered row. Reading order or row association requires manual inspection.';
          continue;
        }
        // Adjacent rows must not combine into an invented record. Require a single baseline,
        // or a contiguous wrapped row with no unusually large vertical/page jump.
        const ev = f.evidence;
        const lines = [...new Set(ev.map((e) => `${e.page}:${Math.round(e.box.y / 3)}`))];
        if (lines.length > 1) {
          f.status = 'manual';
          f.reason =
            'Row text matches, but spans multiple baselines/pages. Cell-to-row geometry requires visual confirmation.';
          continue;
        }
      }
      if (expected.kind === 'link') {
        usedLinkLabels.push(m);
        const wholeItems = !spans.some(
          (s) => (s.start < m.start && s.end > m.start) || (s.start < m.end && s.end > m.end),
        );
        const nearby = pdf.links
          .map((l, i) => ({ l, i }))
          .filter(
            ({ l, i }) =>
              wholeItems &&
              !usedLinks.has(i) &&
              f.evidence.every(
                (e) =>
                  e.page === l.page &&
                  e.box.x >= l.box.x - 2 &&
                  e.box.x + e.box.width <= l.box.x + l.box.width + 2 &&
                  e.box.y >= l.box.y - 2 &&
                  e.box.y + e.box.height <= l.box.y + l.box.height + 2,
              ),
          );
        const exact =
          nearby.length === 1 && nearby[0].l.href === expected.href ? nearby[0] : undefined;
        if (exact) {
          usedLinks.add(exact.i);
          f.actualHref = exact.l.href;
        } else if (nearby.length === 1) {
          usedLinks.add(nearby[0].i);
          f.actualHref = nearby[0].l.href;
          f.status = 'mismatch';
          f.reason = 'The PDF link annotation at this label has a different destination.';
          continue;
        } else {
          f.status = 'manual';
          f.reason =
            'Link label is present, but a unique URL annotation could not be associated with it. Internal PDF destinations are not resolved in v0.1.';
          continue;
        }
      }
      f.status = 'found';
      f.reason =
        expected.kind === 'link'
          ? 'Label and URL annotation found in this section. Visibility still requires visual inspection.'
          : 'Independent occurrence found in this section’s text layer. This does not prove visibility.';
    }
  }
  const active = findings.filter((f) => !f.excluded);
  const status: Status = active.some((f) => f.status === 'mismatch')
    ? 'mismatch'
    : active.some((f) => f.status === 'unverifiable')
      ? 'unverifiable'
      : active.some((f) => f.status === 'manual')
        ? 'manual'
        : active.length
          ? 'found'
          : 'unverifiable';
  return {
    schema: 'printwitness-report/1',
    createdAt: new Date().toISOString(),
    manifest,
    pdf: { ...identity, pages: pdf.pages },
    status,
    findings,
    warnings: [
      'Text-layer presence does not prove visibility. Clipping, overlays and transparency are not universally detected.',
      ...pdf.warnings,
    ],
  };
}
