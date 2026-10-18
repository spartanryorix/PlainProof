'use client';

import { useCallback, useRef, useState } from 'react';
import { FileText, UploadCloud, ClipboardPaste, Sparkles, AlertTriangle, FileCheck2, ScanText, X, Check, Plus } from 'lucide-react';
import { api, formatBytes, uploadFile, type UploadResult } from '@/lib/client/api';
import { SAMPLES } from '@/lib/samples';
import { LANGUAGES, PROFILES, PROFILE_ORDER, TONES, type LanguageCode, type ProfileId, type ToneId } from '@/lib/engine/profiles';
import type { RunRequest } from '@/lib/engine/types';
import { Button, Card, cx, Segmented, Tip } from './ui';
import { useHealth } from './providers';

const ACCEPT = '.pdf,.docx,.txt,.md,.png,.jpg,.jpeg,.webp';
const KIND_LABEL: Record<string, string> = { pdf: 'PDF', docx: 'Word document', txt: 'Text', image: 'Image', text: 'Text' };

type UploadState =
  | { kind: 'idle' }
  | { kind: 'uploading'; file: File; progress: number }
  | { kind: 'processing'; file: File }
  | { kind: 'error'; message: string; file?: File };

export function Uploader({ onCreated, compact }: { onCreated: (r: UploadResult) => void; compact?: boolean }) {
  const health = useHealth();
  const [mode, setMode] = useState<'file' | 'paste'>('file');
  const [state, setState] = useState<UploadState>({ kind: 'idle' });
  const [drag, setDrag] = useState(false);
  const [text, setText] = useState('');
  const [busySample, setBusySample] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const maxMb = health?.limits.maxUploadMb ?? 15;

  const send = useCallback(
    async (file: File) => {
      if (file.size > maxMb * 1024 * 1024) return setState({ kind: 'error', message: `This file is ${formatBytes(file.size)}. The limit is ${maxMb} MB.`, file });
      if (!file.size) return setState({ kind: 'error', message: 'This file is empty.', file });
      setState({ kind: 'uploading', file, progress: 0 });
      try {
        const result = await uploadFile(file, (p) => setState(p >= 1 ? { kind: 'processing', file } : { kind: 'uploading', file, progress: p }));
        setState({ kind: 'idle' });
        onCreated(result);
      } catch (err) {
        setState({ kind: 'error', message: (err as Error).message, file });
      }
    },
    [maxMb, onCreated],
  );

  const sendText = async () => {
    setState({ kind: 'processing', file: new File([text], 'Pasted text') });
    try {
      onCreated(await api<UploadResult>('/api/documents', { method: 'POST', body: JSON.stringify({ text }) }));
      setState({ kind: 'idle' });
    } catch (err) {
      setState({ kind: 'error', message: (err as Error).message });
    }
  };

  const useSample = async (id: string) => {
    setBusySample(id);
    try {
      onCreated(await api<UploadResult>('/api/documents', { method: 'POST', body: JSON.stringify({ sample: id }) }));
    } catch (err) {
      setState({ kind: 'error', message: (err as Error).message });
    } finally {
      setBusySample(null);
    }
  };

  const busy = state.kind === 'uploading' || state.kind === 'processing';

  return (
    <div className="space-y-4">
      {!compact && (
        <Segmented
          label="How to add the document"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'file', label: 'Upload a file' },
            { value: 'paste', label: 'Paste text' },
          ]}
        />
      )}

      {mode === 'file' ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            const f = e.dataTransfer.files[0];
            if (f) void send(f);
          }}
          className={cx(
            'relative flex flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 text-center transition-colors',
            compact ? 'py-10' : 'py-14',
            drag ? 'border-accent bg-accent-soft' : 'border-border-strong bg-surface hover:border-accent/60',
          )}
        >
          {busy ? (
            <UploadProgress state={state} />
          ) : (
            <>
              <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
                <UploadCloud className="size-6" />
              </div>
              <p className="font-display text-[17px] font-semibold">Drop a document here</p>
              <p className="mt-1 text-sm text-text-2">PDF, Word, text, or a photo of a letter. Up to {maxMb} MB.</p>
              <Button variant="primary" className="mt-5" onClick={() => input.current?.click()} icon={<FileText className="size-4" />}>
                Browse files
              </Button>
              <input
                ref={input}
                type="file"
                accept={ACCEPT}
                className="sr-only"
                aria-label="Choose a document to upload"
                data-testid="file-input"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) void send(f);
                }}
              />
            </>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste the text of a letter, notice or policy…"
            aria-label="Document text"
            className="min-h-56 w-full resize-y rounded-2xl border border-border bg-surface p-4 text-[15px] leading-relaxed outline-none focus:border-accent focus:ring-4 focus:ring-[var(--accent-ring)]"
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-text-3">{text.trim() ? `${text.trim().split(/\s+/).length} words` : ''}</span>
            <Button variant="primary" onClick={sendText} disabled={text.trim().length < 40} loading={busy} icon={<ClipboardPaste className="size-4" />}>
              Use this text
            </Button>
          </div>
        </div>
      )}

      {state.kind === 'error' && (
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-bad/25 bg-bad-soft px-4 py-3 text-sm text-text">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-bad" />
          <div className="flex-1">
            <p className="font-medium">{state.file ? `${state.file.name} could not be used` : 'That did not work'}</p>
            <p className="mt-0.5 text-text-2">{state.message}</p>
          </div>
          <button aria-label="Dismiss" onClick={() => setState({ kind: 'idle' })} className="text-text-3 hover:text-text">
            <X className="size-4" />
          </button>
        </div>
      )}

      <div>
        <p className="mb-2 text-xs font-medium text-text-3">Or try a sample document (all fictional)</p>
        <div className="flex flex-wrap gap-2">
          {SAMPLES.map((s) => (
            <Tip key={s.id} label={s.description}>
              <button
                onClick={() => useSample(s.id)}
                disabled={busy || Boolean(busySample)}
                className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3.5 py-1.5 text-[13px] font-medium text-text-2 transition-colors hover:border-accent/50 hover:text-text disabled:opacity-50"
              >
                <Sparkles className={cx('size-3.5 text-accent', busySample === s.id && 'animate-soft-pulse')} />
                {s.label}
              </button>
            </Tip>
          ))}
        </div>
      </div>
    </div>
  );
}

function UploadProgress({ state }: { state: UploadState }) {
  if (state.kind !== 'uploading' && state.kind !== 'processing') return null;
  const pct = state.kind === 'uploading' ? Math.round(state.progress * 100) : 100;
  return (
    <div className="w-full max-w-sm" aria-live="polite">
      <div className="mb-3 flex items-center gap-3 text-start">
        <div className="flex size-10 items-center justify-center rounded-xl bg-accent-soft text-accent">{state.kind === 'processing' ? <ScanText className="size-5 animate-soft-pulse" /> : <UploadCloud className="size-5" />}</div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{state.file.name}</p>
          <p className="text-xs text-text-3">
            {formatBytes(state.file.size)} · {state.kind === 'uploading' ? `Uploading ${pct}%` : 'Extracting text… scans and photos are read with OCR, which can take a little longer'}
          </p>
        </div>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-bg-subtle" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className={cx('h-full rounded-full bg-accent transition-[width]', state.kind === 'processing' && 'animate-soft-pulse')} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function DocumentSummary({ result, onReplace }: { result: UploadResult; onReplace?: () => void }) {
  const d = result.document;
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-start gap-4 border-b border-border p-5">
        <div className="flex size-11 items-center justify-center rounded-xl bg-ok-soft text-ok">
          <FileCheck2 className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-[15px] font-semibold">{d.filename ?? d.title}</p>
          <p className="mt-0.5 text-[13px] text-text-2">
            {[KIND_LABEL[d.mime ?? ''] ?? 'Document', d.sizeBytes ? formatBytes(d.sizeBytes) : null, d.pages ? `${d.pages} page${d.pages === 1 ? '' : 's'}` : null, `${d.words.toLocaleString()} words`].filter(Boolean).join(' · ')}
          </p>
          <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-ok">
            <Check className="size-3.5" /> Text extracted: {d.extraction}
          </p>
        </div>
        {onReplace && (
          <Button variant="ghost" size="sm" onClick={onReplace}>
            Use a different document
          </Button>
        )}
      </div>
      {result.warnings.length > 0 && (
        <div className="space-y-1 border-b border-border bg-warn-soft/60 px-5 py-3 text-[13px] text-text">
          {result.warnings.map((w) => (
            <p key={w} className="flex gap-2">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warn" />
              {w}
            </p>
          ))}
        </div>
      )}
      <div className="max-h-56 overflow-auto px-5 py-4">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">Extracted text preview</p>
        <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-text-2" dir="auto">
          {d.text.slice(0, 1600)}
          {d.text.length > 1600 && '…'}
        </p>
      </div>
    </Card>
  );
}

export type RunSettings = RunRequest;

export const DEFAULT_RUN: RunSettings = {
  profiles: [{ id: 'teen' }, { id: 'senior' }],
  language: 'en',
  tone: 'neutral',
  storyMode: false,
  protectedTerms: [],
  maxRepairs: 2,
  injectFault: false,
};

export function AudiencePicker({ value, onChange, lockedProfiles = [] }: { value: RunSettings; onChange: (v: RunSettings) => void; lockedProfiles?: ProfileId[] }) {
  const health = useHealth();
  const preview = health?.mode === 'preview';
  const [term, setTerm] = useState('');
  const selected = new Set(value.profiles.map((p) => p.id));
  const toggle = (id: ProfileId) => {
    const next = selected.has(id) ? value.profiles.filter((p) => p.id !== id) : [...value.profiles, { id }];
    onChange({ ...value, profiles: PROFILE_ORDER.filter((x) => next.some((p) => p.id === x)).map((x) => ({ id: x })) });
  };
  const addTerm = () => {
    const t = term.trim();
    if (t && !value.protectedTerms.includes(t)) onChange({ ...value, protectedTerms: [...value.protectedTerms, t].slice(0, 30) });
    setTerm('');
  };

  return (
    <div className="space-y-8">
      <section>
        <h3 className="font-display text-[15px] font-semibold">Who is this for?</h3>
        <p className="mt-0.5 text-sm text-text-2">Pick one or more audiences. Each gets its own explanation, checked against the same facts.</p>
        <div className="mt-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3" role="group" aria-label="Audiences">
          {PROFILE_ORDER.map((id) => {
            const p = PROFILES[id];
            const on = selected.has(id);
            const locked = lockedProfiles.includes(id);
            return (
              <button
                key={id}
                role="checkbox"
                aria-checked={on}
                disabled={locked}
                onClick={() => toggle(id)}
                className={cx(
                  'group relative flex flex-col items-start rounded-xl border p-3.5 text-start transition-all disabled:opacity-50',
                  on ? 'border-accent bg-accent-soft/70 ring-1 ring-accent' : 'border-border bg-surface hover:border-border-strong',
                )}
              >
                <span className={cx('absolute end-3 top-3 flex size-5 items-center justify-center rounded-md border transition-colors', on ? 'border-accent bg-accent text-accent-fg' : 'border-border-strong')}>
                  {on && <Check className="size-3.5" />}
                </span>
                <span className="font-display text-[14px] font-semibold">{p.label}</span>
                <span className="mt-0.5 pe-6 text-[12.5px] leading-snug text-text-2">{locked ? 'Already generated' : p.description}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="grid gap-6 sm:grid-cols-2">
        <div>
          <label htmlFor="language" className="font-display text-[15px] font-semibold">
            Language
          </label>
          <select
            id="language"
            value={value.language}
            onChange={(e) => onChange({ ...value, language: e.target.value as LanguageCode })}
            className="mt-2 h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm outline-none focus:border-accent focus:ring-4 focus:ring-[var(--accent-ring)]"
          >
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code} disabled={preview && l.needsModel}>
                {l.label}
                {preview && l.needsModel ? ' (needs the AI model)' : ''}
              </option>
            ))}
          </select>
          {preview && <p className="mt-1.5 text-xs text-text-3">Arabic and Tamil need the AI model. Preview Mode cannot translate.</p>}
        </div>
        <div>
          <span className="font-display text-[15px] font-semibold">Tone</span>
          <div className="mt-2">
            <Segmented label="Tone" value={value.tone} onChange={(t: ToneId) => onChange({ ...value, tone: t })} options={Object.entries(TONES).map(([v, t]) => ({ value: v as ToneId, label: t.label }))} />
          </div>
        </div>
      </section>

      <details className="group rounded-xl border border-border bg-surface-2 px-4 py-3">
        <summary className="flex items-center justify-between text-sm font-medium text-text-2 marker:content-none">
          Advanced: protected terms, repair attempts, demo options
          <Plus className="size-4 transition-transform group-open:rotate-45" />
        </summary>
        <div className="mt-4 space-y-5">
          <div>
            <label htmlFor="terms" className="text-sm font-medium">
              Do-not-simplify list
            </label>
            <p className="text-xs text-text-3">Names, drug names or legal phrases that must stay exactly as written.</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-xl border border-border bg-surface p-2 focus-within:border-accent">
              {value.protectedTerms.map((t) => (
                <span key={t} className="inline-flex items-center gap-1 rounded-lg bg-accent-soft px-2 py-1 text-xs font-medium text-accent">
                  {t}
                  <button aria-label={`Remove ${t}`} onClick={() => onChange({ ...value, protectedTerms: value.protectedTerms.filter((x) => x !== t) })}>
                    <X className="size-3" />
                  </button>
                </span>
              ))}
              <input
                id="terms"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault();
                    addTerm();
                  }
                }}
                onBlur={addTerm}
                placeholder={value.protectedTerms.length ? '' : 'Type a term and press Enter'}
                className="min-w-40 flex-1 bg-transparent px-1 py-1 text-sm outline-none"
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
            <label className="flex items-center gap-2 text-sm">
              Repair attempts
              <select
                value={value.maxRepairs}
                onChange={(e) => onChange({ ...value, maxRepairs: Number(e.target.value) })}
                className="h-8 rounded-lg border border-border bg-surface px-2 text-sm"
              >
                {[0, 1, 2, 3].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={value.storyMode} onChange={(e) => onChange({ ...value, storyMode: e.target.checked })} />
              Story mode for the Child version
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={value.injectFault} onChange={(e) => onChange({ ...value, injectFault: e.target.checked })} />
              Demo: inject a test error into the first draft
            </label>
          </div>
        </div>
      </details>
    </div>
  );
}

const STEPS = ['Upload', 'Personalize', 'Understand', 'Verify', 'Share'];

export function Steps({ current }: { current: number }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]" aria-label="Progress">
      {STEPS.map((s, i) => (
        <li key={s} className="flex items-center gap-2" aria-current={i === current ? 'step' : undefined}>
          <span
            className={cx(
              'flex size-5 items-center justify-center rounded-full text-[11px] font-semibold',
              i < current ? 'bg-accent text-accent-fg' : i === current ? 'bg-text text-bg' : 'bg-bg-subtle text-text-3 ring-1 ring-border',
            )}
          >
            {i + 1}
          </span>
          <span className={cx(i === current ? 'font-medium text-text' : 'text-text-3')}>{s}</span>
          {i < STEPS.length - 1 && <span className="mx-1 h-px w-5 bg-border" aria-hidden />}
        </li>
      ))}
    </ol>
  );
}

