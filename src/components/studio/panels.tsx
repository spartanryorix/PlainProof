'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, Loader2, Circle, FlaskConical, ShieldAlert, X, Undo2, CalendarClock, ArrowRight, Type, Quote, FileSearch } from 'lucide-react';
import { findingOf } from '@/lib/engine/scoring';
import type { Claim, ClaimResult, Finding, Invention, ReviewDecision } from '@/lib/engine/types';
import type { ActionItem } from '@/lib/engine/actions';
import { Button, cx, FindingBadge, FINDING_STYLE, OUTCOME_STYLE, Segmented, Tip } from '@/components/ui';
import { usePrefs } from '@/components/providers';
import type { Track, ViewRound } from './useStudio';

export function PanelHeader({ title, meta, children }: { title: string; meta?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-3 border-b border-border px-4 py-2">
      <div className="min-w-0">
        <h2 className="truncate text-[13px] font-semibold">{title}</h2>
        {meta && <p className="truncate text-[11.5px] text-text-3">{meta}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1">{children}</div>
    </div>
  );
}

// ---------- outcome ----------

const SHORT: Record<Finding, string> = { matched: 'Matched', review: 'Review', mismatch: 'Mismatch', missing: 'Missing', unverified: 'Unchecked' };

export function OutcomeCard({ round, semantic, track, viewRound, onPickRound }: { round: ViewRound | null; semantic: boolean; track: Track; viewRound: number | null; onPickRound: (n: number | null) => void }) {
  const a = round?.assessment;
  if (!a) {
    return (
      <div className="rounded-xl border border-border bg-surface-2 p-4">
        <div className="flex items-center gap-2 text-sm font-medium text-text-2">
          <Loader2 className="size-4 animate-spin text-accent" /> {track.phase === 'error' ? 'Not finished' : 'Checking facts…'}
        </div>
        <div className="mt-3 grid grid-cols-5 gap-2">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="skeleton h-10" />
          ))}
        </div>
      </div>
    );
  }
  const style = OUTCOME_STYLE[a.outcome];
  const Icon = a.outcome === 'clear' ? CheckCircle2 : a.outcome === 'review' ? AlertTriangle : XCircle;
  const cells: [Finding, number][] = [
    ['matched', a.counts.matched],
    ['review', a.counts.review],
    ['mismatch', a.counts.mismatch],
    ['missing', a.counts.missing],
    ['unverified', a.counts.unverified],
  ];
  return (
    <div className="rounded-xl border border-border bg-surface p-4" data-testid="outcome">
      <div className="flex items-start gap-3">
        <div className={cx('flex size-9 shrink-0 items-center justify-center rounded-xl', style.soft, style.text)}>
          <Icon className="size-5" />
        </div>
        <div className="min-w-0">
          <p className={cx('font-display text-[17px] font-semibold leading-tight', style.text)}>
            {style.label}
            {!semantic && <span className="ms-1.5 align-middle text-xs font-medium text-text-3">lexical check</span>}
          </p>
          <p className="mt-0.5 text-[12.5px] text-text-2">
            {a.counts.matched} of {a.counts.total} facts matched · critical {a.counts.criticalMatched} of {a.counts.critical}
          </p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-5 gap-1.5">
        {cells.map(([f, n]) => (
          <Tip key={f} label={FINDING_STYLE[f].label}>
            <div className={cx('rounded-lg px-1.5 py-1.5 text-center', n ? FINDING_STYLE[f].soft : 'bg-bg-subtle')}>
              <div className={cx('font-display text-[15px] font-semibold tabular-nums', n ? FINDING_STYLE[f].text : 'text-text-3')}>{n}</div>
              <div className="truncate text-[10px] text-text-3">{SHORT[f]}</div>
            </div>
          </Tip>
        ))}
      </div>
      <p className="mt-3 flex gap-1.5 text-[11.5px] leading-snug text-text-3">
        {semantic ? (
          'Checked by an independent AI verifier, with quotes and numbers matched mechanically. An assessment, not a guarantee.'
        ) : (
          <>
            <FlaskConical className="mt-px size-3.5 shrink-0 text-warn" />
            Preview Mode: semantic verification not performed. Rule-based lexical and number checks only.
          </>
        )}
      </p>
      {track.rounds.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border pt-3" role="group" aria-label="Verification rounds">
          {track.rounds.map((r, i) => {
            const shown = (viewRound ?? track.finalRound ?? track.rounds.length - 1) === i;
            const o = r.assessment?.outcome;
            return (
              <button
                key={i}
                onClick={() => onPickRound(i === (track.finalRound ?? track.rounds.length - 1) ? null : i)}
                aria-pressed={shown}
                className={cx('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors', shown ? 'border-text bg-surface text-text' : 'border-border text-text-2 hover:border-border-strong')}
              >
                <span className={cx('size-1.5 rounded-full', !o ? 'bg-border-strong' : o === 'clear' ? 'bg-ok' : o === 'review' ? 'bg-warn' : 'bg-bad')} />
                {r.kind === 'draft' ? 'Draft' : r.kind === 'repair' ? `Repair ${i}` : 'Your edit'}
              </button>
            );
          })}
        </div>
      )}
      {round?.fault && (
        <p className="mt-3 rounded-lg bg-warn-soft px-3 py-2 text-[12px] text-text">
          <strong className="font-semibold">Test error injected.</strong> {round.fault.description}.
        </p>
      )}
      {round && round.missingTerms.length > 0 && (
        <p className="mt-2 rounded-lg bg-bad-soft px-3 py-2 text-[12px] text-text">Protected term changed: {round.missingTerms.join(', ')}</p>
      )}
    </div>
  );
}

// ---------- claim map ----------

export function ClaimDots({ claims, results, reveal, selected, onSelect, targets }: { claims: Claim[]; results: ClaimResult[] | null; reveal: boolean; selected: string | null; onSelect: (id: string) => void; targets?: string[] }) {
  const byId = new Map((results ?? []).map((r) => [r.id, r]));
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="list" aria-label="Facts">
      {claims.map((c, i) => {
        const f = results ? findingOf(byId.get(c.id)) : 'pending';
        const style = FINDING_STYLE[f];
        return (
          <Tip key={c.id} label={`${style.label}: ${c.text}`}>
            <button
              role="listitem"
              aria-label={`${c.text} (${style.label})`}
              onClick={() => onSelect(c.id)}
              style={{ ['--i' as string]: i }}
              className={cx(
                'rounded-full transition-transform hover:scale-125',
                c.criticality === 'critical' ? 'size-3.5' : 'size-2.5',
                style.dot,
                !results && 'animate-soft-pulse',
                reveal && results && 'animate-reveal',
                targets?.includes(c.id) && 'animate-soft-pulse',
                selected === c.id && 'ring-2 ring-accent ring-offset-2 ring-offset-surface',
              )}
            />
          </Tip>
        );
      })}
    </div>
  );
}

// ---------- live progress ----------

export function RunProgress({ track, extracting }: { track: Track; extracting: boolean }) {
  const p = track.phase;
  const repairs = track.rounds.filter((r) => r.kind === 'repair').length;
  const steps: [string, 'done' | 'active' | 'idle'][] = [
    ['Extract facts from the original', extracting ? 'active' : 'done'],
    ['Write the explanation', p === 'writing' ? 'active' : track.rounds.length ? 'done' : 'idle'],
    ['Check every fact independently', p === 'verifying' ? 'active' : track.rounds.some((r) => r.assessment) ? 'done' : 'idle'],
    [track.live?.repairing ? `Repair ${track.live.repairing.problems} problem${track.live.repairing.problems === 1 ? '' : 's'}` : repairs ? `Repaired (${repairs} round${repairs === 1 ? '' : 's'})` : 'Repair if needed', p === 'repairing' ? 'active' : repairs ? 'done' : 'idle'],
  ];
  return (
    <ol className="space-y-2 rounded-xl border border-border bg-surface p-4" aria-live="polite">
      {steps.map(([label, s]) => (
        <li key={label} className={cx('flex items-center gap-2.5 text-[13px]', s === 'idle' ? 'text-text-3' : 'text-text')}>
          {s === 'done' ? <CheckCircle2 className="size-4 text-ok" /> : s === 'active' ? <Loader2 className="size-4 animate-spin text-accent" /> : <Circle className="size-4 text-border-strong" />}
          <span className={cx(s === 'active' && 'font-medium')}>{label}</span>
        </li>
      ))}
    </ol>
  );
}

// ---------- claim inspector ----------

export function ClaimInspector({
  claim,
  result,
  decision,
  canReview,
  onReview,
  onUndo,
  onClose,
  semantic,
}: {
  claim: Claim;
  result: ClaimResult | null;
  decision: ReviewDecision | undefined;
  canReview: boolean;
  onReview: (note: string) => void;
  onUndo: () => void;
  onClose?: () => void;
  semantic: boolean;
}) {
  const [note, setNote] = useState('');
  const finding: Finding | 'pending' = result ? findingOf(result) : 'pending';
  return (
    <div className="animate-fade-up rounded-xl border border-accent/40 bg-surface p-4 shadow-soft" data-testid="inspector">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <FindingBadge finding={finding} reviewed={Boolean(decision)} />
          <span className="rounded-full bg-bg-subtle px-2 py-0.5 text-[11px] font-medium text-text-2">{claim.type}</span>
          {claim.criticality === 'critical' && <span className="rounded-full bg-text px-2 py-0.5 text-[11px] font-medium text-bg">critical</span>}
        </div>
        {onClose && (
          <button onClick={onClose} aria-label="Close fact" className="rounded-md p-1 text-text-3 hover:bg-bg-subtle hover:text-text">
            <X className="size-4" />
          </button>
        )}
      </div>
      <dl className="mt-3 space-y-3 text-[13px]">
        <div>
          <dt className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.07em] text-text-3">
            <FileSearch className="size-3.5" /> Original{claim.paragraph ? ` · paragraph ${claim.paragraph}` : ''}
          </dt>
          <dd className="mt-1 border-s-2 border-border-strong ps-3 text-text-2" dir="auto">
            {claim.source_quote || claim.text}
          </dd>
        </div>
        <div>
          <dt className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.07em] text-text-3">
            <Type className="size-3.5" /> Extracted fact
          </dt>
          <dd className="mt-1" dir="auto">
            {claim.text}
          </dd>
          {claim.values.length > 0 && (
            <dd className="mt-1.5 flex flex-wrap gap-1">
              {claim.values.map((v) => (
                <span key={v} className="rounded-md bg-bg-subtle px-1.5 py-0.5 font-mono text-[11px] text-text-2">
                  {v}
                </span>
              ))}
            </dd>
          )}
        </div>
        <div>
          <dt className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.07em] text-text-3">
            <Quote className="size-3.5" /> In the explanation
          </dt>
          <dd className="mt-1 border-s-2 border-accent/50 ps-3" dir="auto">
            {result ? result.evidence || <em className="text-text-3">Not stated in the explanation.</em> : <em className="text-text-3">Checking…</em>}
          </dd>
        </div>
        {result && (
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-[0.07em] text-text-3">Finding</dt>
            <dd className="mt-1 text-text-2">
              {result.note ||
                (finding === 'matched'
                  ? semantic
                    ? 'The verifier found this fact stated with the same meaning, numbers and conditions.'
                    : 'The lexical check found a sentence with the same key words and numbers.'
                  : '')}
              {result.flags.length > 0 && (
                <ul className="mt-1.5 space-y-1">
                  {result.flags.map((f) => (
                    <li key={f} className="flex gap-1.5 text-warn">
                      <ShieldAlert className="mt-0.5 size-3.5 shrink-0" /> {f}
                    </li>
                  ))}
                </ul>
              )}
            </dd>
          </div>
        )}
      </dl>
      {canReview && result && finding !== 'matched' && (
        <div className="mt-4 border-t border-dashed border-border pt-3">
          {decision ? (
            <div className="flex items-center justify-between gap-2 text-[12.5px]">
              <span className="text-ok">
                <CheckCircle2 className="me-1 inline size-3.5" />
                Reviewed{decision.reviewer ? ` by ${decision.reviewer}` : ''} · {new Date(decision.at).toLocaleString()}
                {decision.note && <span className="mt-0.5 block text-text-2">“{decision.note}”</span>}
              </span>
              <Button size="sm" variant="ghost" onClick={onUndo} icon={<Undo2 className="size-3.5" />}>
                Undo
              </Button>
            </div>
          ) : (
            <div className="flex gap-2">
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Optional note for the receipt"
                aria-label="Review note"
                className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-surface px-2.5 text-[13px] outline-none focus:border-accent"
              />
              <Button size="sm" variant="primary" onClick={() => onReview(note.trim())}>
                Mark reviewed
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function UnsupportedList({ inventions, onReview, decisions, canReview }: { inventions: Invention[]; onReview: (i: number) => void; decisions: ReviewDecision[]; canReview: boolean }) {
  if (!inventions.length) return null;
  return (
    <div className="space-y-2">
      {inventions.map((inv, i) => {
        const done = decisions.find((d) => d.item === `inv${i}`);
        return (
          <div key={i} className="rounded-xl border border-bad/25 bg-bad-soft/50 p-3 text-[13px]">
            <p className="font-medium" dir="auto">
              “{inv.quote}”
            </p>
            <p className="mt-1 text-text-2">
              {inv.note} <span className="text-text-3">({inv.severity === 'high' ? 'could change what the reader does' : 'low severity'}, {inv.source === 'guard' ? 'number check' : 'detector'})</span>
            </p>
            {canReview && (
              <div className="mt-2 text-end">
                {done ? <span className="text-xs text-ok">Reviewed</span> : <Button size="sm" variant="secondary" onClick={() => onReview(i)}>Mark reviewed</Button>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------- actions preview ----------

export function ActionRow({ action, done, onToggle, onJump, compact }: { action: ActionItem; done: boolean; onToggle?: () => void; onJump: () => void; compact?: boolean }) {
  return (
    <div className={cx('flex items-start gap-3 rounded-xl border border-border bg-surface p-3', done && 'opacity-60')}>
      {onToggle ? (
        <input type="checkbox" checked={done} onChange={onToggle} aria-label={`Mark "${action.text}" as done`} className="mt-1 size-4 shrink-0 accent-[var(--accent)]" />
      ) : (
        <span className={cx('mt-1.5 size-2 shrink-0 rounded-full', FINDING_STYLE[action.finding].dot)} />
      )}
      <div className="min-w-0 flex-1">
        <p className={cx('text-[13.5px] leading-snug', done && 'line-through')} dir="auto">
          {action.text}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11.5px]">
          {action.deadline && (
            <span className="inline-flex items-center gap-1 rounded-md bg-accent-soft px-1.5 py-0.5 font-medium text-accent">
              <CalendarClock className="size-3" /> {action.deadline}
            </span>
          )}
          {action.amount && <span className="rounded-md bg-bg-subtle px-1.5 py-0.5 font-mono text-text-2">{action.amount}</span>}
          {!compact && <FindingBadge finding={action.finding} />}
          <button onClick={onJump} className="inline-flex items-center gap-0.5 text-text-3 hover:text-accent">
            {action.paragraphs.length ? `¶${action.paragraphs.join(', ¶')}` : 'Evidence'} <ArrowRight className="size-3" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- reader controls ----------

export function ReaderControls() {
  const { prefs, setPrefs } = usePrefs();
  return (
    <div className="space-y-3 p-1 text-[13px]">
      <div className="flex items-center justify-between gap-4">
        <span className="text-text-2">Font</span>
        <Segmented size="sm" label="Font" value={prefs.readerFont} onChange={(v) => setPrefs({ readerFont: v })} options={[{ value: 'default', label: 'Inter' }, { value: 'lexend', label: 'Lexend' }, { value: 'atkinson', label: 'Atkinson' }]} />
      </div>
      <div className="flex items-center justify-between gap-4">
        <span className="text-text-2">Size</span>
        <Segmented size="sm" label="Text size" value={prefs.readerSize} onChange={(v) => setPrefs({ readerSize: v })} options={[{ value: 'normal', label: 'A' }, { value: 'large', label: 'A+' }, { value: 'xl', label: 'A++' }]} />
      </div>
      <div className="flex items-center justify-between gap-4">
        <span className="text-text-2">Spacing</span>
        <Segmented size="sm" label="Spacing" value={prefs.readerSpacing} onChange={(v) => setPrefs({ readerSpacing: v })} options={[{ value: 'normal', label: 'Normal' }, { value: 'wide', label: 'Wide' }]} />
      </div>
      <label className="flex items-center justify-between gap-4">
        <span className="text-text-2">Line focus</span>
        <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={prefs.lineFocus} onChange={(e) => setPrefs({ lineFocus: e.target.checked })} />
      </label>
    </div>
  );
}

export function Popover({ trigger, children, label }: { trigger: (open: boolean, toggle: () => void) => ReactNode; children: ReactNode; label: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      {trigger(open, () => setOpen((o) => !o))}
      {open && (
        <div role="dialog" aria-label={label} className="animate-fade-up absolute end-0 top-full z-40 mt-2 w-72 rounded-xl border border-border bg-surface p-3 shadow-pop">
          {children}
        </div>
      )}
    </div>
  );
}
