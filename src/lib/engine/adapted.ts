// The Writer and Repairer answer in a plain-text format with section markers, so drafts can
// stream token by token. List items carry the claim ids they restate ("- [c4] Pay by ...").

import type { Adapted, AdaptedItem } from './types';
import type { Labels } from './profiles';

export const SECTION_MARKERS = {
  title: 'TITLE',
  overview: 'OVERVIEW',
  changes: 'WHAT CHANGED',
  actions: 'ACTIONS',
  warnings: 'WARNINGS',
  keyFacts: 'KEY DATES AND AMOUNTS',
  explanation: 'EXPLANATION',
  definitions: 'DEFINITIONS',
} as const;

type SectionKey = keyof typeof SECTION_MARKERS;

const MARKER = /^\s*#*\s*\**\s*(TITLE|OVERVIEW|WHAT CHANGED|ACTIONS|WARNINGS|KEY DATES AND AMOUNTS|EXPLANATION|DEFINITIONS)\s*\**\s*[:：]\s*(.*)$/i;
const BULLET = /^\s*(?:[-*•]|\d{1,2}[.)])\s+/;
const TAGS = /^\s*\[((?:\s*c\d+\s*,?)+)\]\s*/i;
const NONE = /^(none|n\/a|nothing|-)\.?$/i;

export function stripThinking(raw: string | null | undefined): string {
  return String(raw ?? '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*$/i, '');
}

const KEY_BY_MARKER: Record<string, SectionKey> = Object.fromEntries(
  Object.entries(SECTION_MARKERS).map(([k, v]) => [v, k as SectionKey]),
);

export function parseItem(line: string): AdaptedItem | null {
  let text = line.replace(BULLET, '').trim();
  let claims: string[] = [];
  const m = text.match(TAGS);
  if (m) {
    claims = m[1].split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    text = text.slice(m[0].length).trim();
  }
  if (!text || NONE.test(text)) return null;
  return { text, claims };
}

export function emptyAdapted(): Adapted {
  return { title: '', overview: '', changes: [], actions: [], warnings: [], keyFacts: [], explanation: '', definitions: [] };
}

export function parseAdapted(raw: string): Adapted {
  const text = stripThinking(raw).replace(/\r/g, '').replace(/\*\*/g, '');
  const sec: Record<SectionKey, string[]> = {
    title: [], overview: [], changes: [], actions: [], warnings: [], keyFacts: [], explanation: [], definitions: [],
  };
  let cur: SectionKey = 'explanation';
  for (const line of text.split('\n')) {
    const m = line.match(MARKER);
    if (m) {
      cur = KEY_BY_MARKER[m[1].toUpperCase()];
      if (m[2].trim()) sec[cur].push(m[2].trim());
      continue;
    }
    sec[cur].push(line);
  }
  const items = (lines: string[]) => lines.map((l) => (l.trim() ? parseItem(l) : null)).filter((x): x is AdaptedItem => Boolean(x));
  const prose = (lines: string[]) => lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const overview = prose(sec.overview);
  return {
    title: sec.title.join(' ').trim(),
    overview: NONE.test(overview) ? '' : overview,
    changes: items(sec.changes),
    actions: items(sec.actions),
    warnings: items(sec.warnings),
    keyFacts: items(sec.keyFacts),
    explanation: prose(sec.explanation),
    definitions: sec.definitions
      .map((l) => l.replace(BULLET, '').trim())
      .map((l) => {
        const i = l.search(/[:：]/);
        return i > 0 ? { term: l.slice(0, i).trim(), explanation: l.slice(i + 1).trim() } : null;
      })
      .filter((g): g is { term: string; explanation: string } => Boolean(g && g.term && g.explanation && !NONE.test(g.term))),
  };
}

const tagged = (i: AdaptedItem) => `- ${i.claims.length ? `[${i.claims.join(', ')}] ` : ''}${i.text}`;
const list = (items: AdaptedItem[]) => (items.length ? items.map(tagged) : ['- none']);

export function serializeAdapted(v: Adapted): string {
  return [
    `TITLE: ${v.title}`,
    'OVERVIEW:',
    v.overview || 'none',
    'WHAT CHANGED:',
    ...list(v.changes),
    'ACTIONS:',
    ...list(v.actions),
    'WARNINGS:',
    ...list(v.warnings),
    'KEY DATES AND AMOUNTS:',
    ...list(v.keyFacts),
    'EXPLANATION:',
    v.explanation,
    'DEFINITIONS:',
    ...(v.definitions.length ? v.definitions.map((d) => `- ${d.term}: ${d.explanation}`) : ['- none']),
  ].join('\n');
}

// What the Verifier reads: everything the reader sees except definitions, and without the
// writer's own claim tags, so the verifier judges the text independently.
export function fullText(v: Adapted): string {
  const items = (xs: AdaptedItem[]) => xs.map((i) => `- ${i.text}`);
  return [v.title, v.overview, ...items(v.changes), ...items(v.actions), ...items(v.warnings), ...items(v.keyFacts), v.explanation]
    .filter(Boolean)
    .join('\n');
}

export type BlockKind = 'title' | 'section' | 'para' | 'item' | 'subheading' | 'bullet' | 'step';
export type BlockSection = 'title' | 'overview' | 'changes' | 'actions' | 'warnings' | 'keyFacts' | 'explanation';

export interface Block {
  kind: BlockKind;
  section: BlockSection;
  text: string;
  claims: string[];
  number?: number;
}

export function toBlocks(v: Adapted, labels: Labels): Block[] {
  const blocks: Block[] = [];
  const push = (kind: BlockKind, section: BlockSection, text: string, claims: string[] = [], number?: number) =>
    blocks.push({ kind, section, text, claims, number });

  if (v.title) push('title', 'title', v.title);
  if (v.overview) {
    push('section', 'overview', labels.overview);
    for (const p of v.overview.split(/\n+/).map((s) => s.trim()).filter(Boolean)) push('para', 'overview', p);
  }
  const lists: [BlockSection, AdaptedItem[], string][] = [
    ['actions', v.actions, labels.actions],
    ['warnings', v.warnings, labels.warnings],
    ['keyFacts', v.keyFacts, labels.keyFacts],
    ['changes', v.changes, labels.changes],
  ];
  for (const [section, items, label] of lists) {
    if (!items.length) continue;
    push('section', section, label);
    for (const item of items) push('item', section, item.text, item.claims);
  }
  if (v.explanation) {
    push('section', 'explanation', labels.explanation);
    for (const raw of v.explanation.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      const step = line.match(/^(\d{1,2})[.)]\s+(.*)$/);
      if (/^#{1,4}\s+/.test(line)) push('subheading', 'explanation', line.replace(/^#{1,4}\s+/, ''));
      else if (step) push('step', 'explanation', step[2], [], Number(step[1]));
      else if (/^[-*•]\s+/.test(line)) push('bullet', 'explanation', line.replace(/^[-*•]\s+/, ''));
      else push('para', 'explanation', line);
    }
  }
  return blocks;
}
