export type Status = 'found' | 'mismatch' | 'manual' | 'unverifiable';
export interface Expectation {
  id: string;
  kind: 'text' | 'row' | 'link';
  text: string;
  cells?: string[];
  href?: string;
  role?: 'table-header';
  excluded?: string;
}
export interface Section {
  id: string;
  selector: string;
  title: string;
  anchor: string;
  before: string | null;
  after: string | null;
  /** First following DOM block, or null only when no following content exists. */
  endContext?: string | null;
  /** Last preceding DOM block, or null at the document start. */
  startContext?: string | null;
  anchorInside?: boolean;
  headers: string[];
  expectations: Expectation[];
}
export interface Manifest {
  schema: 'printwitness/1';
  createdAt: string;
  source: { name: string; sha256: string; readiness: string };
  exclusions: string[];
  sections: Section[];
}
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface PdfToken {
  text: string;
  page: number;
  box: Box;
  lineEnd?: boolean;
}
export interface PdfLink {
  page: number;
  box: Box;
  href: string;
}
export interface PdfPage {
  number: number;
  width: number;
  height: number;
  text: string;
}
export interface PdfIndex {
  pages: PdfPage[];
  tokens: PdfToken[];
  links: PdfLink[];
  warnings: string[];
  error?: string;
}
export interface Evidence {
  page: number;
  box: Box;
  text: string;
}
export interface Finding {
  id: string;
  sectionId: string;
  section: string;
  kind: Expectation['kind'];
  expected: string;
  href?: string;
  actualHref?: string;
  status: Status;
  reason: string;
  evidence: Evidence[];
  excluded?: string;
}
export interface Report {
  schema: 'printwitness-report/1';
  createdAt: string;
  manifest: Manifest;
  pdf: { name: string; sha256: string; pages: PdfPage[] };
  status: Status;
  findings: Finding[];
  warnings: string[];
}
