'use client';

// Turns text plus evidence marks into flat spans. Marks come from real claim mappings: the
// writer's claim tags, the verifier's quotes, and the original passages of each claim.

import { Fragment, type ReactNode } from 'react';
import { findQuote, splitSentences, splitParagraphs } from '@/lib/engine/text';
import { toBlocks, type Block } from '@/lib/engine/adapted';
import { findingOf } from '@/lib/engine/scoring';
import type { Labels } from '@/lib/engine/profiles';
import type { Adapted, Claim, ClaimResult, Finding, Invention } from '@/lib/engine/types';
import { cx } from '@/components/ui';

export type MarkFinding = Finding | 'pending';

export interface Mark {
  start: number;
  end: number;
  claims?: string[];
  finding?: MarkFinding;
  unsupported?: number;
  gloss?: { term: string; explanation: string };
}

const RANK: Record<MarkFinding, number> = { matched: 0, pending: 1, unverified: 2, review: 3, missing: 4, mismatch: 5 };
export const worstFinding = (fs: MarkFinding[]): MarkFinding => fs.reduce<MarkFinding>((w, f) => (RANK[f] > RANK[w] ? f : w), fs[0] ?? 'pending');

interface Segment {
  text: string;
  claims: string[];
  finding: MarkFinding | null;
  unsupported: number | null;
  gloss: Mark['gloss'] | null;
  s: number | null;
}

function segments(text: string, marks: Mark[], sentences: { start: number; end: number }[] | null, base: number): Segment[] {
  const cuts = new Set([0, text.length]);
  for (const m of marks) cuts.add(Math.max(0, m.start)).add(Math.min(text.length, m.end));
  for (const s of sentences ?? []) cuts.add(s.start).add(s.end);
  const points = [...cuts].sort((a, b) => a - b);
  const out: Segment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (a === b) continue;
    const cover = marks.filter((m) => m.start <= a && m.end >= b);
    const claimMarks = cover.filter((m) => m.claims?.length);
    const si = sentences ? sentences.findIndex((s) => s.start <= a && s.end >= b) : -1;
    out.push({
      text: text.slice(a, b),
      claims: [...new Set(claimMarks.flatMap((m) => m.claims!))],
      finding: claimMarks.length ? worstFinding(claimMarks.map((m) => m.finding ?? 'pending')) : null,
      unsupported: cover.find((m) => m.unsupported !== undefined)?.unsupported ?? null,
      gloss: cover.find((m) => m.gloss)?.gloss ?? null,
      s: si >= 0 ? base + si : null,
    });
  }
  return out;
}

export interface MarkHandlers {
  selected?: string | null;
  speaking?: number | null;
  focus?: number | null;
  onSelect?: (claimId: string) => void;
  onGloss?: (gloss: { term: string; explanation: string }, el: HTMLElement) => void;
}

export function Annotated({ text, marks, sentenceBase = 0, withSentences = false, handlers }: { text: string; marks: Mark[]; sentenceBase?: number; withSentences?: boolean; handlers: MarkHandlers }) {
  const segs = segments(text, marks, withSentences ? splitSentences(text) : null, sentenceBase);
  return (
    <>
      {segs.map((seg, i) => {
        const marked = seg.finding || seg.unsupported !== null || seg.gloss;
        if (!marked && seg.s === null) return <Fragment key={i}>{seg.text}</Fragment>;
        const selected = handlers.selected && seg.claims.includes(handlers.selected);
        const className = cx(
          marked && 'mark',
          seg.finding && `mark-${seg.finding}`,
          seg.unsupported !== null && 'mark-unsupported',
          seg.gloss && 'mark-gloss',
          selected && 'is-selected',
          seg.s !== null && seg.s === handlers.speaking && 'is-speaking',
          seg.s !== null && seg.s === handlers.focus && 'is-focus',
        );
        const interactive = seg.claims.length > 0 || seg.gloss;
        return (
          <span
            key={i}
            className={className || undefined}
            data-s={seg.s ?? undefined}
            data-claims={seg.claims.length ? seg.claims.join(' ') : undefined}
            role={interactive ? 'button' : undefined}
            tabIndex={interactive ? 0 : undefined}
            aria-label={seg.claims.length ? `Inspect fact ${seg.claims.join(', ')}` : seg.gloss ? `Definition of ${seg.gloss.term}` : undefined}
            onClick={
              interactive
                ? (e) => {
                    e.stopPropagation();
                    if (seg.claims.length) handlers.onSelect?.(seg.claims[0]);
                    if (seg.gloss) handlers.onGloss?.(seg.gloss, e.currentTarget);
                  }
                : undefined
            }
            onKeyDown={
              interactive
                ? (e) => {
                    if (e.key !== 'Enter' && e.key !== ' ') return;
                    e.preventDefault();
                    if (seg.claims.length) handlers.onSelect?.(seg.claims[0]);
                    if (seg.gloss) handlers.onGloss?.(seg.gloss, e.currentTarget);
                  }
                : undefined
            }
          >
            {seg.text}
          </span>
        );
      })}
    </>
  );
}

// ---------- explanation ----------

export interface ExplanationModel {
  blocks: (Block & { marks: Mark[]; sentenceBase: number })[];
  sentences: { index: number; text: string }[];
}

const findWord = (text: string, term: string) => {
  const m = new RegExp(`(?<![\\p{L}\\p{N}])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'iu').exec(text);
  return m ? { start: m.index, end: m.index + m[0].length } : null;
};

export function explanationModel(version: Adapted, labels: Labels, results: ClaimResult[] | null, inventions: Invention[] = [], glossary = true): ExplanationModel {
  const byId = new Map((results ?? []).map((r) => [r.id, r]));
  const findingFor = (id: string): MarkFinding => (results ? findingOf(byId.get(id)) : 'pending');
  const sentences: ExplanationModel['sentences'] = [];
  let base = 0;
  const blocks = toBlocks(version, labels).map((b) => {
    const marks: Mark[] = [];
    if (b.kind !== 'section') {
      const tagged = b.claims.filter((id) => !results || byId.has(id));
      if (tagged.length) marks.push({ start: 0, end: b.text.length, claims: tagged, finding: worstFinding(tagged.map(findingFor)) });
      for (const r of results ?? []) {
        const at = r.evidence ? findQuote(b.text, r.evidence) : null;
        if (at) marks.push({ ...at, claims: [r.id], finding: findingFor(r.id) });
      }
      inventions.forEach((inv, i) => {
        const at = findQuote(b.text, inv.quote);
        if (at) marks.push({ ...at, unsupported: i });
      });
      if (glossary) {
        for (const d of version.definitions) {
          const at = findWord(b.text, d.term);
          if (at) marks.push({ ...at, gloss: d });
        }
      }
    }
    const ss = splitSentences(b.text);
    ss.forEach((s, i) => sentences.push({ index: base + i, text: s.text }));
    const block = { ...b, marks, sentenceBase: base };
    base += ss.length;
    return block;
  });
  return { blocks, sentences };
}

export function ExplanationBody({ model, handlers, definitionsLabel, definitions }: { model: ExplanationModel; handlers: MarkHandlers; definitionsLabel: string; definitions: Adapted['definitions'] }) {
  const out: ReactNode[] = [];
  let list: { kind: 'ul' | 'ol'; section: string; items: ReactNode[] } | null = null;
  const flush = () => {
    if (!list) return;
    const sectionStyle =
      list.section === 'actions' ? 'rounded-xl bg-accent-soft/60 px-4 py-3' : list.section === 'warnings' ? 'rounded-xl border-l-4 border-warn bg-warn-soft/60 px-4 py-3' : '';
    out.push(
      list.kind === 'ol' ? (
        <ol key={`l${out.length}`} className="my-3 list-decimal space-y-2 ps-6">
          {list.items}
        </ol>
      ) : (
        <ul key={`l${out.length}`} className={cx('my-3 space-y-2', sectionStyle, list.section === 'explanation' ? 'list-disc ps-6' : 'list-none')}>
          {list.items}
        </ul>
      ),
    );
    list = null;
  };
  model.blocks.forEach((b, i) => {
    const content = <Annotated text={b.text} marks={b.marks} sentenceBase={b.sentenceBase} withSentences handlers={handlers} />;
    const kind = b.kind === 'step' ? 'ol' : b.kind === 'item' || b.kind === 'bullet' ? 'ul' : null;
    if (kind) {
      if (!list || list.kind !== kind || list.section !== b.section) {
        flush();
        list = { kind, section: b.section, items: [] };
      }
      list.items.push(
        <li key={i} className={cx(b.kind === 'item' && b.section === 'actions' && 'flex gap-2.5')}>
          {b.kind === 'item' && b.section === 'actions' && <span aria-hidden className="mt-[0.45em] size-3.5 shrink-0 rounded-[4px] border-[1.5px] border-accent" />}
          <span>{content}</span>
        </li>,
      );
      return;
    }
    flush();
    if (b.kind === 'title') out.push(<h2 key={i} className="mb-4 font-display text-[1.45em] font-semibold leading-tight tracking-tight">{content}</h2>);
    else if (b.kind === 'section') out.push(<h3 key={i} className="mb-1 mt-7 text-[0.72em] font-semibold uppercase tracking-[0.09em] text-text-3">{content}</h3>);
    else if (b.kind === 'subheading') out.push(<h4 key={i} className="mb-1 mt-5 font-display font-semibold">{content}</h4>);
    else out.push(<p key={i} className="my-3">{content}</p>);
  });
  flush();
  if (definitions.length) {
    out.push(
      <div key="defs" className="mt-8 border-t border-border pt-5">
        <h3 className="mb-3 text-[0.72em] font-semibold uppercase tracking-[0.09em] text-text-3">{definitionsLabel}</h3>
        <dl className="grid gap-x-5 gap-y-2 text-[0.92em] sm:grid-cols-[auto_1fr]">
          {definitions.map((d) => (
            <Fragment key={d.term}>
              <dt className="font-semibold">{d.term}</dt>
              <dd className="text-text-2">{d.explanation}</dd>
            </Fragment>
          ))}
        </dl>
      </div>,
    );
  }
  return <>{out}</>;
}

// ---------- original document ----------

export function OriginalBody({ text, claims, results, handlers }: { text: string; claims: Claim[]; results: ClaimResult[] | null; handlers: MarkHandlers }) {
  const byId = new Map((results ?? []).map((r) => [r.id, r]));
  const all: Mark[] = [];
  for (const c of claims) {
    const at = c.source_quote ? findQuote(text, c.source_quote) : null;
    if (at) all.push({ ...at, claims: [c.id], finding: results ? findingOf(byId.get(c.id)) : 'pending' });
  }
  return (
    <>
      {splitParagraphs(text).map((p) => {
        const marks = all
          .filter((m) => m.start < p.end && m.end > p.start)
          .map((m) => ({ ...m, start: Math.max(0, m.start - p.start), end: Math.min(p.text.length, m.end - p.start) }));
        return (
          <div key={p.index} className="group relative mb-4 ps-9" id={`para-${p.index}`}>
            <span className="absolute start-0 top-0.5 w-6 select-none text-end font-mono text-[11px] text-text-3" aria-label={`Paragraph ${p.index}`}>
              ¶{p.index}
            </span>
            <p className="whitespace-pre-wrap">
              <Annotated text={p.text} marks={marks} handlers={handlers} />
            </p>
          </div>
        );
      })}
    </>
  );
}
