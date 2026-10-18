'use client';

import { useMemo, useState } from 'react';
import { Copy, Download, FileJson, FileText, Printer, Share2, ListChecks, CheckCircle2, AlertTriangle, ArrowLeftRight, Package, ShieldCheck, FlaskConical, Link2 } from 'lucide-react';
import { findingOf, reviewStatus, FINDING_LABEL } from '@/lib/engine/scoring';
import { readability, splitParagraphs, findQuote } from '@/lib/engine/text';
import { checklistText, type ActionItem } from '@/lib/engine/actions';
import { labelsFor, languageOf, outputLabelCode, isRtl, PROFILES } from '@/lib/engine/profiles';
import type { Claim, Finding, Invention, ReviewDecision } from '@/lib/engine/types';
import { api, download, type DocumentRow, type VersionRow } from '@/lib/client/api';
import { Button, Card, cx, EmptyState, FindingBadge, FINDING_STYLE, OUTCOME_STYLE, Segmented } from '@/components/ui';
import { useToast } from '@/components/providers';
import { Annotated, ExplanationBody, explanationModel, type MarkHandlers } from '@/components/doc/annotate';
import { ActionRow, ClaimInspector, UnsupportedList } from './panels';
import type { Track, ViewRound } from './useStudio';

// ---------- MeaningLock ----------

export function MeaningLockView({
  doc,
  claims,
  round,
  decisions,
  canReview,
  selected,
  onSelect,
  onReview,
  onUndo,
  semantic,
}: {
  doc: DocumentRow;
  claims: Claim[];
  round: ViewRound | null;
  decisions: ReviewDecision[];
  canReview: boolean;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onReview: (item: string, label: string, note: string) => void;
  onUndo: (item: string) => void;
  semantic: boolean;
}) {
  const [filter, setFilter] = useState<'all' | 'issues' | 'critical' | 'reviewed'>('all');
  const results = round?.results ?? null;
  const byId = new Map((results ?? []).map((r) => [r.id, r]));
  const reviewed = new Set(decisions.map((d) => d.item));
  const finding = (id: string): Finding | 'pending' => (results ? findingOf(byId.get(id)) : 'pending');
  const counts = {
    all: claims.length,
    issues: claims.filter((c) => !['matched', 'pending'].includes(finding(c.id))).length,
    critical: claims.filter((c) => c.criticality === 'critical').length,
    reviewed: claims.filter((c) => reviewed.has(c.id)).length,
  };
  const shown = claims.filter((c) =>
    filter === 'all' ? true : filter === 'issues' ? !['matched', 'pending'].includes(finding(c.id)) : filter === 'critical' ? c.criticality === 'critical' : reviewed.has(c.id),
  );
  const current = claims.find((c) => c.id === selected) ?? null;
  const paragraph = current?.paragraph ? splitParagraphs(doc.text).find((p) => p.index === current.paragraph) : null;

  return (
    <div className="grid gap-5 p-4 sm:p-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
          <div>
            <h2 className="font-display text-[15px] font-semibold">MeaningLock</h2>
            <p className="text-[12.5px] text-text-2">Every fact extracted from the original, and what the explanation does with it.</p>
          </div>
          <Segmented
            size="sm"
            label="Filter facts"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: `All ${counts.all}` },
              { value: 'issues', label: `Issues ${counts.issues}` },
              { value: 'critical', label: `Critical ${counts.critical}` },
              { value: 'reviewed', label: `Reviewed ${counts.reviewed}` },
            ]}
          />
        </div>
        <ul className="max-h-[calc(100dvh-280px)] divide-y divide-border overflow-auto" aria-label="Facts">
          {shown.length === 0 && <li className="p-6 text-center text-sm text-text-3">Nothing here.</li>}
          {shown.map((c) => {
            const f = finding(c.id);
            return (
              <li key={c.id}>
                <button
                  onClick={() => onSelect(selected === c.id ? null : c.id)}
                  aria-pressed={selected === c.id}
                  className={cx('grid w-full grid-cols-[auto_1fr_auto] items-start gap-3 px-4 py-3 text-start transition-colors hover:bg-surface-2', selected === c.id && 'bg-accent-soft/50')}
                >
                  <span className={cx('mt-1.5 rounded-full', c.criticality === 'critical' ? 'size-3' : 'size-2.5', FINDING_STYLE[f].dot)} />
                  <span className="min-w-0">
                    <span className="block text-[13.5px] leading-snug" dir="auto">
                      {c.text}
                    </span>
                    <span className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-text-3">
                      <span>{c.type}</span>
                      {c.criticality === 'critical' && <span className="font-medium text-text-2">critical</span>}
                      {c.paragraph && <span>¶{c.paragraph}</span>}
                    </span>
                  </span>
                  <FindingBadge finding={f} reviewed={reviewed.has(c.id)} />
                </button>
              </li>
            );
          })}
        </ul>
        {round && round.inventions.length > 0 && (
          <div className="border-t border-border p-4">
            <h3 className="mb-2 text-[13px] font-semibold">Statements not supported by the original</h3>
            <UnsupportedList inventions={round.inventions} decisions={decisions} canReview={canReview} onReview={(i) => onReview(`inv${i}`, round.inventions[i].quote, '')} />
          </div>
        )}
      </Card>
      <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
        {current ? (
          <>
            <ClaimInspector
              key={current.id}
              claim={current}
              result={byId.get(current.id) ?? null}
              decision={decisions.find((d) => d.item === current.id)}
              canReview={canReview}
              onReview={(note) => onReview(current.id, current.text, note)}
              onUndo={() => onUndo(current.id)}
              onClose={() => onSelect(null)}
              semantic={semantic}
            />
            {paragraph && (
              <Card className="p-4">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.07em] text-text-3">Context in the original · ¶{paragraph.index}</p>
                <p className="text-[13.5px] leading-relaxed text-text-2" dir="auto">
                  <Annotated
                    text={paragraph.text}
                    marks={(() => {
                      const at = findQuote(paragraph.text, current.source_quote);
                      return at ? [{ ...at, claims: [current.id], finding: finding(current.id) }] : [];
                    })()}
                    handlers={{ selected: current.id }}
                  />
                </p>
              </Card>
            )}
          </>
        ) : (
          <Card>
            <EmptyState icon={<ShieldCheck className="size-6" />} title="Select a fact">
              See the original passage, the extracted fact, what the explanation says, and why the verifier reached its finding.
            </EmptyState>
          </Card>
        )}
      </div>
    </div>
  );
}

// ---------- ActionLens ----------

export function ActionLensView({
  title,
  actions,
  warnings,
  unlinked,
  done,
  canEdit,
  onToggle,
  onJump,
}: {
  title: string;
  actions: ActionItem[];
  warnings: ActionItem[];
  unlinked: number;
  done: string[];
  canEdit: boolean;
  onToggle: (id: string) => void;
  onJump: (claimId: string) => void;
}) {
  const toast = useToast();
  const [filter, setFilter] = useState<'all' | 'open' | 'done'>('all');
  const shown = actions.filter((a) => (filter === 'all' ? true : filter === 'open' ? !done.includes(a.id) : done.includes(a.id)));
  const exportList = () => {
    const blob = new Blob([checklistText(title, actions, done)], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'plainproof-checklist.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const copy = async (a: ActionItem) => {
    try {
      await navigator.clipboard.writeText([a.text, a.deadline && `Deadline: ${a.deadline}`, a.amount && `Amount: ${a.amount}`].filter(Boolean).join(' · '));
      toast('Task copied.', 'success');
    } catch {
      toast('Copying is blocked in this browser.', 'error');
    }
  };
  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-semibold tracking-tight">ActionLens</h2>
          <p className="mt-0.5 text-sm text-text-2">
            {actions.length ? `${done.filter((d) => actions.some((a) => a.id === d)).length} of ${actions.length} done.` : 'No actions found.'} Every item links back to the original document.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Segmented size="sm" label="Filter tasks" value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All' }, { value: 'open', label: 'Outstanding' }, { value: 'done', label: 'Done' }]} />
          <Button size="sm" onClick={exportList} disabled={!actions.length} icon={<Download className="size-3.5" />}>
            Export checklist
          </Button>
        </div>
      </div>
      {!actions.length ? (
        <Card>
          <EmptyState icon={<ListChecks className="size-6" />} title="Nothing to do">
            The document does not ask the reader to do anything, or the explanation has not been generated yet.
          </EmptyState>
        </Card>
      ) : (
        <div className="space-y-2.5">
          {shown.map((a) => (
            <div key={a.id} className="group relative">
              <ActionRow action={a} done={done.includes(a.id)} onToggle={canEdit ? () => onToggle(a.id) : undefined} onJump={() => onJump(a.claimIds[0])} />
              <button onClick={() => copy(a)} aria-label="Copy task" className="absolute end-3 top-3 rounded-md p-1.5 text-text-3 opacity-0 transition hover:bg-bg-subtle hover:text-text focus:opacity-100 group-hover:opacity-100">
                <Copy className="size-3.5" />
              </button>
            </div>
          ))}
          {shown.length === 0 && <p className="py-6 text-center text-sm text-text-3">Nothing in this filter.</p>}
        </div>
      )}
      {unlinked > 0 && (
        <p className="text-xs text-text-3">
          {unlinked} item{unlinked === 1 ? '' : 's'} in the explanation could not be linked to a fact in the original, so {unlinked === 1 ? 'it is' : 'they are'} not listed here.
        </p>
      )}
      {warnings.length > 0 && (
        <section>
          <h3 className="mb-3 flex items-center gap-2 font-display text-[15px] font-semibold">
            <AlertTriangle className="size-4 text-warn" /> Important warnings
          </h3>
          <div className="space-y-2.5">
            {warnings.map((w) => (
              <ActionRow key={w.id} action={w} done={false} onJump={() => onJump(w.claimIds[0])} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ---------- Understanding Compare ----------

export function CompareView({ doc, tracks, claims, selected, onSelect }: { doc: DocumentRow; tracks: Track[]; claims: Claim[]; selected: string | null; onSelect: (id: string | null) => void }) {
  const saved = tracks.filter((t) => t.saved);
  const preferred = ['teen', 'senior'];
  const initial = [saved.find((t) => t.profile === preferred[0]) ?? saved[0], saved.find((t) => t.profile === preferred[1] && t.key !== (saved.find((x) => x.profile === preferred[0]) ?? saved[0])?.key) ?? saved.find((t) => t.key !== (saved.find((x) => x.profile === preferred[0]) ?? saved[0])?.key)];
  const [leftKey, setLeftKey] = useState(initial[0]?.key ?? '');
  const [rightKey, setRightKey] = useState(initial[1]?.key ?? '');
  const sides = [saved.find((t) => t.key === leftKey), saved.find((t) => t.key === rightKey)];

  const models = useMemo(
    () =>
      sides.map((t) => {
        if (!t?.saved) return null;
        const v = t.saved;
        const round = v.rounds[v.finalRound];
        const code = outputLabelCode(v.language, doc.sourceLanguage ?? '');
        const model = explanationModel(round.version, labelsFor(code), round.results, round.inventions, false);
        const linked = new Set(model.blocks.flatMap((b) => b.marks.flatMap((m) => m.claims ?? [])));
        const text = model.sentences.map((s) => s.text).join(' ');
        return { t, v, round, code, model, linked, stats: readability(text) };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [leftKey, rightKey, tracks],
  );

  if (saved.length < 2) {
    return (
      <div className="p-6">
        <Card>
          <EmptyState icon={<ArrowLeftRight className="size-6" />} title="Generate a second audience to compare">
            Understanding Compare shows two explanations of the same document side by side, with every shared fact linked to the same original passage.
          </EmptyState>
        </Card>
      </div>
    );
  }

  const shared = claims.filter((c) => models[0]?.linked.has(c.id) && models[1]?.linked.has(c.id));
  const current = claims.find((c) => c.id === selected) ?? null;
  const handlers: MarkHandlers = { selected, onSelect: (id) => onSelect(selected === id ? null : id) };
  const paragraph = current?.paragraph ? splitParagraphs(doc.text).find((p) => p.index === current.paragraph) : null;

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-semibold tracking-tight">Understanding Compare</h2>
          <p className="text-sm text-text-2">Different explanations. Shared evidence. Click a fact to see it in both versions and in the original.</p>
        </div>
      </div>
      <Card className="p-4">
        <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.07em] text-text-3">
          <Link2 className="size-3.5" /> {shared.length} facts linked in both versions
        </p>
        <div className="flex flex-wrap gap-1.5">
          {shared.map((c) => (
            <button
              key={c.id}
              onClick={() => onSelect(selected === c.id ? null : c.id)}
              aria-pressed={selected === c.id}
              className={cx(
                'max-w-64 truncate rounded-full border px-2.5 py-1 text-[12px] transition-colors',
                selected === c.id ? 'border-accent bg-accent-soft text-accent' : 'border-border text-text-2 hover:border-border-strong hover:text-text',
              )}
              title={c.text}
            >
              {c.values[0] ? `${c.values[0]} · ` : ''}
              {c.type}
            </button>
          ))}
        </div>
        {current && (
          <div className="mt-4 grid gap-3 border-t border-border pt-4 md:grid-cols-[1.2fr_1fr_1fr]">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-text-3">Original{paragraph ? ` · ¶${paragraph.index}` : ''}</p>
              <p className="mt-1 text-[13px] text-text-2" dir="auto">
                {current.source_quote}
              </p>
            </div>
            {models.map((m, i) => {
              const r = m?.round.results.find((x) => x.id === current.id);
              return (
                <div key={i}>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-text-3">{m ? PROFILES[m.v.profile].label : ''}</p>
                  <div className="mt-1">
                    <FindingBadge finding={findingOf(r)} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        {models.map((m, i) => (
          <Card key={i} className="flex min-h-0 flex-col overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
              <select
                aria-label={i === 0 ? 'Left version' : 'Right version'}
                value={i === 0 ? leftKey : rightKey}
                onChange={(e) => (i === 0 ? setLeftKey(e.target.value) : setRightKey(e.target.value))}
                className="h-8 rounded-lg border border-border bg-surface px-2 text-[13px] font-medium"
              >
                {saved.map((t) => (
                  <option key={t.key} value={t.key}>
                    {PROFILES[t.profile].label} · {t.language === 'source' ? 'original language' : languageOf(t.language).name}
                  </option>
                ))}
              </select>
              {m && (
                <span className="text-[11.5px] text-text-3">
                  {m.stats.words} words · {m.stats.wordsPerSentence} words per sentence{m.code === 'en' ? ` · grade ${m.stats.grade}` : ''}
                </span>
              )}
            </div>
            {m && (
              <div className="reader compare-pane max-h-[calc(100dvh-330px)] overflow-auto px-5 py-4" lang={m.code} dir={isRtl(m.v.language, doc.sourceLanguage ?? '') ? 'rtl' : 'ltr'} data-pane={`compare-${i}`}>
                <ExplanationBody model={m.model} handlers={handlers} definitions={[]} definitionsLabel="" />
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}

// ---------- ProofPass ----------

export function ProofPassView({ doc, version, inventions }: { doc: DocumentRow; version: VersionRow | null; inventions: Invention[] }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  if (!version) {
    return (
      <div className="p-6">
        <Card>
          <EmptyState icon={<ShieldCheck className="size-6" />} title="No receipt yet">
            A ProofPass receipt is issued when an explanation finishes verification.
          </EmptyState>
        </Card>
      </div>
    );
  }
  const r = version.receipt;
  const results = r.claims.map((c) => c.result);
  const review = reviewStatus(results, inventions, version.review);
  const v = r.verification;
  const o = OUTCOME_STYLE[v.outcome];
  const reviewLabel = review.status === 'reviewed' ? 'Reviewed by a person' : review.status === 'partially-reviewed' ? 'Partially reviewed by a person' : 'Not reviewed by a person';

  const share = async () => {
    setBusy('share');
    try {
      const { url } = await api<{ url: string }>(`/api/versions/${version.id}/share`, { method: 'POST' });
      const full = `${location.origin}${url}`;
      const copied = await navigator.clipboard.writeText(full).then(
        () => true,
        () => false,
      );
      toast(`Share link ${copied ? 'copied' : 'created'}: ${full}`, 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };
  const copyText = async () => {
    try {
      const res = await fetch(`/api/versions/${version.id}/export?format=txt`);
      if (!res.ok) throw new Error('Could not load the text.');
      await navigator.clipboard.writeText(await res.text());
      toast('Explanation copied.', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };
  const pdf = async () => {
    setBusy('pdf');
    try {
      const res = await fetch(`/api/versions/${version.id}/receipt?format=pdf`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'The PDF could not be created.');
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `${r.receiptId}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const row = (k: string, val: React.ReactNode) => (
    <div className="grid grid-cols-[150px_1fr] gap-3 border-b border-border py-2.5 text-[13px] last:border-0">
      <dt className="text-text-3">{k}</dt>
      <dd className="min-w-0 break-words">{val}</dd>
    </div>
  );

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-accent">ProofPass · Fidelity Receipt</p>
          <h2 className="font-display text-2xl font-semibold tracking-tight">{r.receiptId}</h2>
          <p className="text-[13px] text-text-3">Issued {new Date(r.issuedAt).toLocaleString()}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={pdf} loading={busy === 'pdf'} icon={<FileText className="size-4" />}>
            Download PDF receipt
          </Button>
          <Button onClick={() => download(`/api/versions/${version.id}/receipt?format=json`)} icon={<FileJson className="size-4" />}>
            JSON
          </Button>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        <Card className="p-5">
          <div className="flex items-center gap-3">
            <span className={cx('rounded-full px-3 py-1 text-sm font-semibold', o.soft, o.text)}>{o.label}</span>
            <span className={cx('inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium', review.status === 'not-reviewed' ? 'bg-bg-subtle text-text-2' : 'bg-ok-soft text-ok')}>
              {review.status === 'not-reviewed' ? <AlertTriangle className="size-3.5" /> : <CheckCircle2 className="size-3.5" />}
              {reviewLabel}
            </span>
          </div>
          <p className={cx('mt-3 flex gap-2 rounded-xl px-3.5 py-2.5 text-[13px]', v.semantic ? 'bg-bg-subtle text-text-2' : 'bg-warn-soft text-text')}>
            {!v.semantic && <FlaskConical className="mt-0.5 size-4 shrink-0 text-warn" />}
            {v.statement}
          </p>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
            {[
              ['Facts extracted', v.claimCount],
              ['Matched', v.counts.matched],
              ['Flagged', v.counts.review + v.counts.mismatch + v.counts.missing + v.counts.unverified],
              ['Unresolved', r.unresolved.length],
              ['Repair attempts', r.repairAttempts],
            ].map(([k, n]) => (
              <div key={k as string} className="rounded-xl bg-bg-subtle px-3 py-2.5">
                <div className="font-display text-xl font-semibold tabular-nums">{n}</div>
                <div className="text-[11px] text-text-3">{k}</div>
              </div>
            ))}
          </div>
          <dl className="mt-4">
            {row('Document', `${r.document.title}${r.document.filename ? ` (${r.document.filename})` : ''}`)}
            {row('Document ID', <code className="font-mono text-[12px]">{r.document.id}</code>)}
            {row('Text extraction', r.document.extraction)}
            {row('Audience', `${r.audience.label} · ${r.audience.tone} tone · reading grade ${r.audience.targetGrade}`)}
            {row('Language', r.audience.languageLabel)}
            {row('Critical facts', `${v.counts.criticalMatched} of ${v.counts.critical} matched`)}
            {row('Writer model', r.engine.writerModel)}
            {row('Verifier model', r.engine.verifierModel)}
            {row('Hardware', r.engine.hardware)}
            {row('Processing', r.cost.preview ? `Preview Mode: ${r.cost.calls} rule-based steps, no AI model and no GPU used` : `${r.cost.totalTokens.toLocaleString()} tokens · ${r.cost.gpuSeconds} s of GPU time · about $${r.cost.usd.toFixed(4)}`)}
          </dl>
        </Card>
        <div className="space-y-5">
          <Card className="p-5">
            <h3 className="font-display text-[15px] font-semibold">Unresolved findings</h3>
            {r.unresolved.length ? (
              <ul className="mt-3 space-y-2">
                {r.unresolved.map((u) => (
                  <li key={u.item} className="rounded-lg bg-bg-subtle px-3 py-2 text-[13px]">
                    <span className="font-medium">{u.finding}</span> <span className="text-text-2" dir="auto">· {u.label}</span>
                    {version.review.some((d) => d.item === u.item) && <span className="ms-1 text-xs text-ok">reviewed</span>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-[13px] text-text-2">None. Every extracted fact was matched{v.semantic ? '' : ' by the lexical check'}.</p>
            )}
          </Card>
          <Card className="p-5">
            <h3 className="font-display text-[15px] font-semibold">Share and export</h3>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <Button onClick={copyText} icon={<Copy className="size-4" />}>
                Copy explanation
              </Button>
              <Button onClick={() => download(`/api/versions/${version.id}/export?format=txt`)} icon={<Download className="size-4" />}>
                Download text
              </Button>
              <Button onClick={() => download(`/api/versions/${version.id}/export?format=html`)} icon={<Package className="size-4" />}>
                Accessible package
              </Button>
              <Button onClick={() => window.print()} icon={<Printer className="size-4" />}>
                Print reader version
              </Button>
              <Button onClick={share} loading={busy === 'share'} icon={<Share2 className="size-4" />} className="sm:col-span-2">
                Create share link
              </Button>
            </div>
            <p className="mt-3 text-xs text-text-3">Every export states whether a person has reviewed it: {reviewLabel.toLowerCase()}.</p>
          </Card>
          <Card className="p-5">
            <h3 className="font-display text-[15px] font-semibold">Limitations</h3>
            <ul className="mt-2 list-disc space-y-1.5 ps-5 text-[13px] text-text-2">
              {r.limitations.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
      <Card className="overflow-hidden">
        <h3 className="border-b border-border px-5 py-3 font-display text-[15px] font-semibold">Facts checked ({r.claims.length})</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="text-start text-[11px] uppercase tracking-[0.06em] text-text-3">
              <tr>
                <th className="px-5 py-2 text-start font-medium">Fact from the original</th>
                <th className="px-3 py-2 text-start font-medium">Finding</th>
                <th className="px-5 py-2 text-start font-medium">Evidence in the explanation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {r.claims.map((c) => (
                <tr key={c.id} className="align-top">
                  <td className="px-5 py-2.5" dir="auto">
                    {c.text}
                    <div className="text-[11px] text-text-3">
                      {c.type} · {c.criticality}
                      {c.paragraph ? ` · ¶${c.paragraph}` : ''}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <FindingBadge finding={c.finding} reviewed={version.review.some((d) => d.item === c.id)} />
                  </td>
                  <td className="px-5 py-2.5 text-text-2" dir="auto">
                    {c.result.evidence || <em className="text-text-3">Not found</em>}
                    {c.result.note && <div className="text-[11.5px] text-text-3">{c.result.note}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="text-center text-xs text-text-3">No accuracy percentage is reported. {FINDING_LABEL.matched} means the check found the fact; it is not a guarantee.</p>
    </div>
  );
}
