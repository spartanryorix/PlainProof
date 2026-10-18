'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AudioLines, ChevronLeft, Plus, RotateCw, PanelRightClose, PanelRightOpen, Square, Settings2, FileText, Sparkles, AlertTriangle, ListChecks, ArrowRight, Loader2, Pencil } from 'lucide-react';
import { deriveActions } from '@/lib/engine/actions';
import { findingOf, flaggedItems } from '@/lib/engine/scoring';
import { serializeAdapted } from '@/lib/engine/adapted';
import { isRtl, labelsFor, languageOf, outputBcp, outputLabelCode, PROFILES } from '@/lib/engine/profiles';
import type { ReviewDecision, RunRequest } from '@/lib/engine/types';
import { api, type VersionRow } from '@/lib/client/api';
import { ExplanationBody, explanationModel, OriginalBody, type MarkHandlers } from '@/components/doc/annotate';
import { AudiencePicker, DEFAULT_RUN } from '@/components/intake';
import { EngineBadge } from '@/components/shell';
import { useHealth, usePrefs, useToast } from '@/components/providers';
import { Button, Card, cx, Dialog, EmptyState, IconButton, Kbd, Segmented, Skeleton, Tip } from '@/components/ui';
import { ActionRow, ClaimDots, ClaimInspector, OutcomeCard, PanelHeader, Popover, ReaderControls, RunProgress } from './panels';
import { ActionLensView, CompareView, MeaningLockView, ProofPassView } from './views';
import { useStudio, streamingVersion, type Track } from './useStudio';
import { useVoiceSync, VoiceDock } from './voice';

type View = 'studio' | 'meaninglock' | 'actions' | 'compare' | 'proofpass';
const VIEWS: { id: View; label: string }[] = [
  { id: 'studio', label: 'Studio' },
  { id: 'meaninglock', label: 'MeaningLock' },
  { id: 'actions', label: 'ActionLens' },
  { id: 'compare', label: 'Compare' },
  { id: 'proofpass', label: 'ProofPass' },
];

const trackLabel = (t: Track) => `${PROFILES[t.profile].label}${t.language === 'en' ? '' : ` · ${t.language === 'source' ? 'Original language' : languageOf(t.language).name}`}`;

export function Studio({ id }: { id: string }) {
  const s = useStudio(id);
  const router = useRouter();
  const params = useSearchParams();
  const health = useHealth();
  const toast = useToast();
  const { prefs } = usePrefs();
  const [view, setView] = useState<View>((params.get('view') as View) || 'studio');
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [viewRound, setViewRound] = useState<number | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [insights, setInsights] = useState(true);
  const [pane, setPane] = useState<'original' | 'explanation' | 'insights'>('explanation');
  const [gloss, setGloss] = useState<{ term: string; explanation: string; x: number; y: number } | null>(null);
  const [addSettings, setAddSettings] = useState<RunRequest>({ ...DEFAULT_RUN, profiles: [] });
  const started = useRef(false);

  // Start the run that the personalize step queued.
  useEffect(() => {
    if (started.current || !s.doc || params.get('run') !== '1') return;
    started.current = true;
    let settings: RunRequest = DEFAULT_RUN;
    try {
      settings = JSON.parse(sessionStorage.getItem(`pp.run.${id}`) ?? 'null') ?? DEFAULT_RUN;
      sessionStorage.removeItem(`pp.run.${id}`);
    } catch {
      /* use defaults */
    }
    setActiveKey(`${settings.profiles[0].id}:${settings.language}`);
    router.replace(`/d/${id}`, { scroll: false });
    void s.run(settings);
  }, [s.doc, params, id, router, s]);

  const tracks = s.tracks;
  const track = tracks.find((t) => t.key === activeKey) ?? tracks[0] ?? null;
  useEffect(() => setViewRound(null), [track?.key]);
  const lastIndex = track ? (track.finalRound ?? track.rounds.length - 1) : -1;
  const round = track ? (track.rounds[viewRound ?? lastIndex] ?? null) : null;
  const streaming = track && viewRound === null ? streamingVersion(track) : null;
  const display = streaming ?? round?.version ?? null;
  const results = streaming ? null : (round?.results ?? null);
  const inventions = streaming ? [] : (round?.inventions ?? []);
  const claims = s.doc?.claims ?? [];
  const sourceLanguage = s.doc?.sourceLanguage ?? '';
  const code = track ? outputLabelCode(track.language, sourceLanguage) : 'en';
  const labels = labelsFor(code);
  const rtl = track ? isRtl(track.language, sourceLanguage) : false;
  const semantic = (s.engine?.semantic ?? health?.semantic) ?? false;
  const saved = track?.saved ?? null;
  const decisions: ReviewDecision[] = saved?.review ?? [];
  const canReview = Boolean(saved && !track?.live && (viewRound === null || viewRound === saved.finalRound));

  const model = useMemo(() => (display ? explanationModel(display, labels, results, inventions) : null), [display, labels, results, inventions]);
  const sentences = useMemo(() => model?.sentences ?? [], [model]);
  const voice = useVoiceSync({ sentences, bcp: track ? outputBcp(track.language, sourceLanguage) : 'en-US', langCode: code, profile: PROFILES[track?.profile ?? 'plain'] });

  const derived = useMemo(() => (display && results ? deriveActions(display, claims, results) : { actions: [], warnings: [], unlinked: 0 }), [display, results, claims]);

  const select = useCallback((claimId: string | null) => setSelected((cur) => (claimId === cur ? cur : claimId)), []);
  const handlers: MarkHandlers = {
    selected,
    speaking: voice.state.speaking,
    onSelect: (cid) => {
      setSelected((cur) => (cur === cid ? null : cid));
      setPane('insights');
    },
    onGloss: (g, el) => {
      const r = el.getBoundingClientRect();
      setGloss({ ...g, x: Math.min(window.innerWidth - 300, r.left), y: r.bottom + 8 });
    },
  };

  // Bring the selected fact into view everywhere it appears.
  useEffect(() => {
    if (!selected) return;
    const t = setTimeout(() => {
      for (const pane of document.querySelectorAll('[data-pane]')) {
        pane.querySelector(`[data-claims~="${selected}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }, 30);
    return () => clearTimeout(t);
  }, [selected, view, track?.key]);

  useEffect(() => {
    if (voice.state.speaking === null) return;
    document.querySelector(`[data-pane="explanation"] [data-s="${voice.state.speaking}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [voice.state.speaking]);

  useEffect(() => {
    if (!gloss) return;
    const close = () => setGloss(null);
    window.addEventListener('scroll', close, true);
    window.addEventListener('mousedown', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('mousedown', close);
    };
  }, [gloss]);

  // Studio shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || t.closest('input, textarea, select, [role="dialog"], [contenteditable="true"]')) return;
      const n = Number(e.key);
      if (n >= 1 && n <= 5) {
        setView(VIEWS[n - 1].id);
        return;
      }
      if (e.key === 'Escape') setSelected(null);
      if ((e.key === 'j' || e.key === 'k') && claims.length) {
        const i = claims.findIndex((c) => c.id === selected);
        const next = e.key === 'j' ? (i + 1) % claims.length : (i - 1 + claims.length) % claims.length;
        setSelected(claims[i < 0 ? 0 : next].id);
      }
      if (e.key === ' ' && !t.closest('button, a')) {
        e.preventDefault();
        setVoiceOpen(true);
        voice.toggle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [claims, selected, voice]);

  const review = async (item: string, label: string, note: string) => {
    if (!saved) return;
    const next = [...decisions.filter((d) => d.item !== item), { item, label, note: note || undefined, reviewer: prefs.reviewer || undefined, at: new Date().toISOString() }];
    try {
      await s.saveVersion(saved.id, { review: next });
      toast('Marked as reviewed. It is recorded on the ProofPass receipt.', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };
  const undo = (item: string) => saved && s.saveVersion(saved.id, { review: decisions.filter((d) => d.item !== item) }).catch((err) => toast((err as Error).message, 'error'));
  const toggleAction = (aid: string) => {
    if (!saved) return;
    const done = saved.actionsDone.includes(aid) ? saved.actionsDone.filter((x) => x !== aid) : [...saved.actionsDone, aid];
    s.saveVersion(saved.id, { actionsDone: done }).catch((err) => toast((err as Error).message, 'error'));
  };
  const jumpTo = (claimId: string) => {
    setView('studio');
    setSelected(claimId);
    setPane('original');
  };

  const startAdd = () => {
    if (!addSettings.profiles.length) return toast('Choose at least one audience.', 'error');
    setAddOpen(false);
    setActiveKey(`${addSettings.profiles[0].id}:${addSettings.language}`);
    void s.run(addSettings);
  };
  const regenerate = () => {
    if (!track) return;
    const prev = track.saved;
    void s.run({
      ...DEFAULT_RUN,
      profiles: [{ id: track.profile }],
      language: track.language,
      tone: prev?.tone ?? 'neutral',
      protectedTerms: prev?.receipt.protectedTerms.required ?? [],
      storyMode: prev?.storyMode ?? false,
    });
  };

  // ---------- states ----------

  if (s.loadError) {
    return (
      <div className="p-6">
        <Card>
          <EmptyState
            icon={<FileText className="size-6" />}
            title={s.loadError.status === 404 ? 'This document is not available' : 'The document could not be loaded'}
            action={
              <div className="flex gap-2">
                <Link href="/library">
                  <Button>Open the library</Button>
                </Link>
                <Button variant="primary" onClick={() => void s.load()}>
                  Try again
                </Button>
              </div>
            }
          >
            {s.loadError.status === 404 ? `It may have been deleted, or removed automatically after ${health?.retentionHours ?? 72} hours.` : s.loadError.message}
          </EmptyState>
        </Card>
      </div>
    );
  }

  if (!s.doc) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-72" />
        <div className="grid gap-4 xl:grid-cols-3">
          <Skeleton className="h-[60vh]" />
          <Skeleton className="h-[60vh]" />
          <Skeleton className="h-[60vh]" />
        </div>
      </div>
    );
  }

  const doc = s.doc;
  const readerClass = cx('reader', `font-${prefs.readerFont}`, `size-${prefs.readerSize}`, `spacing-${prefs.readerSpacing}`, prefs.lineFocus && 'line-focus', prefs.lineFocus && voice.state.speaking !== null && 'has-focus');

  const original = (
    <Card className="flex min-h-0 flex-col overflow-hidden">
      <PanelHeader title="Original document" meta={`${doc.filename ?? 'Pasted text'} · ${doc.extraction} · ${doc.words.toLocaleString()} words`} />
      <div data-pane="original" className="min-h-0 flex-1 overflow-auto px-4 py-4 text-[13.5px] leading-relaxed text-text-2" dir="auto">
        <OriginalBody text={doc.text} claims={claims} results={results} handlers={handlers} />
      </div>
    </Card>
  );

  const explanation = (
    <Card className="flex min-h-0 flex-col overflow-hidden">
      <PanelHeader title={track ? `For: ${trackLabel(track)}` : 'Explanation'} meta={track ? `${PROFILES[track.profile].description}${viewRound !== null ? ' · earlier round' : ''}` : undefined}>
        <Tip label="Listen (Space)">
          <button onClick={() => setVoiceOpen((o) => !o)} disabled={!display} className={cx('inline-flex size-9 items-center justify-center rounded-lg transition-colors disabled:opacity-40', voiceOpen ? 'bg-accent-soft text-accent' : 'text-text-2 hover:bg-bg-subtle hover:text-text')} aria-label="Listen with VoiceSync">
            <AudioLines className="size-[18px]" />
          </button>
        </Tip>
        <Popover
          label="Reader settings"
          trigger={(open, toggle) => (
            <IconButton label="Reader settings" onClick={toggle} className={open ? 'bg-accent-soft text-accent' : ''}>
              <Settings2 className="size-[18px]" />
            </IconButton>
          )}
        >
          <ReaderControls />
        </Popover>
        {canReview && (
          <IconButton label="Edit and re-verify" onClick={() => setEditOpen(true)}>
            <Pencil className="size-[17px]" />
          </IconButton>
        )}
      </PanelHeader>
      <div data-pane="explanation" className={cx('min-h-0 flex-1 overflow-auto px-6 py-5', readerClass)} lang={code} dir={rtl ? 'rtl' : 'ltr'}>
        {!display || !model ? (
          <div className="space-y-3">
            <p className="flex items-center gap-2 text-sm text-text-3">
              <Loader2 className="size-4 animate-spin" /> {s.extracting || !claims.length ? 'Reading the document and extracting facts…' : 'Writing the explanation…'}
            </p>
            <Skeleton className="h-7 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-4 w-4/5" />
          </div>
        ) : (
          <div className={cx(streaming && 'caret')}>
            <ExplanationBody model={model} handlers={handlers} definitions={streaming ? [] : display.definitions} definitionsLabel={labels.definitions} />
            {!streaming && doc.domain && ['medical', 'legal', 'financial', 'government', 'insurance'].includes(doc.domain) && (
              <p className="mt-8 border-t border-border pt-4 text-[0.82em] text-text-3">{labels.official}</p>
            )}
          </div>
        )}
      </div>
    </Card>
  );

  const current = claims.find((c) => c.id === selected) ?? null;
  const flagged = results ? flaggedItems(results, inventions).filter((k) => !k.startsWith('inv')) : [];
  const insightsPanel = track && (
    <div data-pane="insights" className="min-h-0 space-y-4 overflow-auto pb-4">
      {track.live && track.phase !== 'error' && <RunProgress track={track} extracting={s.extracting} />}
      {track.live?.error && (
        <div role="alert" className="rounded-xl border border-bad/25 bg-bad-soft p-3 text-[13px]">
          <p className="font-medium">This version did not finish.</p>
          <p className="mt-0.5 text-text-2">{track.live.error}</p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" onClick={regenerate} icon={<RotateCw className="size-3.5" />}>
              Try again
            </Button>
            {track.saved && (
              <Button size="sm" variant="ghost" onClick={() => s.dismissLive(track.key)}>
                Show the previous version
              </Button>
            )}
          </div>
        </div>
      )}
      <OutcomeCard round={streaming ? null : round} semantic={semantic} track={track} viewRound={viewRound} onPickRound={setViewRound} />
      {current && (
        <ClaimInspector
          key={current.id + (results ? 'r' : 'p')}
          claim={current}
          result={results?.find((r) => r.id === current.id) ?? null}
          decision={decisions.find((d) => d.item === current.id)}
          canReview={canReview}
          onReview={(note) => review(current.id, current.text, note)}
          onUndo={() => undo(current.id)}
          onClose={() => setSelected(null)}
          semantic={semantic}
        />
      )}
      {claims.length > 0 && (
        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-[13px] font-semibold">MeaningLock · {claims.length} facts</h3>
            <button onClick={() => setView('meaninglock')} className="inline-flex items-center gap-1 text-xs text-text-3 hover:text-accent">
              Open <ArrowRight className="size-3" />
            </button>
          </div>
          <ClaimDots claims={claims} results={results} reveal={track.live?.reveal === (viewRound ?? lastIndex)} selected={selected} onSelect={(cid) => setSelected(cid)} targets={track.live?.repairing?.targets} />
          {flagged.length > 0 && (
            <ul className="mt-3 space-y-1.5 border-t border-border pt-3">
              {flagged.slice(0, 6).map((cid) => {
                const c = claims.find((x) => x.id === cid);
                const r = results?.find((x) => x.id === cid);
                if (!c) return null;
                const f = findingOf(r);
                return (
                  <li key={cid}>
                    <button onClick={() => setSelected(cid)} className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-start text-[12.5px] hover:bg-bg-subtle">
                      <AlertTriangle className={cx('mt-0.5 size-3.5 shrink-0', f === 'review' ? 'text-warn' : 'text-bad')} />
                      <span className="line-clamp-2" dir="auto">
                        {c.text}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
      {derived.actions.length > 0 && (
        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="flex items-center gap-1.5 text-[13px] font-semibold">
              <ListChecks className="size-4 text-accent" /> ActionLens
            </h3>
            <button onClick={() => setView('actions')} className="inline-flex items-center gap-1 text-xs text-text-3 hover:text-accent">
              All {derived.actions.length} <ArrowRight className="size-3" />
            </button>
          </div>
          <div className="space-y-2">
            {derived.actions.slice(0, 3).map((a) => (
              <ActionRow key={a.id} action={a} compact done={saved?.actionsDone.includes(a.id) ?? false} onJump={() => jumpTo(a.claimIds[0])} />
            ))}
          </div>
        </div>
      )}
      {(saved?.cost || s.cost) && (
        <p className="px-1 text-[11.5px] text-text-3">
          {(() => {
            const c = track.live ? s.cost : saved?.cost;
            if (!c) return null;
            return c.preview ? `Preview Mode · ${c.calls} rule-based steps · no GPU used` : `${c.totalTokens.toLocaleString()} tokens · ${c.gpuSeconds} s on ${health?.hardware ?? 'GPU'} · about $${c.usd.toFixed(4)}`;
          })()}
        </p>
      )}
    </div>
  );

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="no-print border-b border-border bg-bg/90 px-4 pb-0 pt-3 backdrop-blur sm:px-6">
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/library" className="inline-flex size-8 items-center justify-center rounded-lg text-text-3 hover:bg-bg-subtle hover:text-text" aria-label="Back to library">
            <ChevronLeft className="size-5" />
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-display text-lg font-semibold tracking-tight">{doc.title}</h1>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden sm:inline-flex">
              <EngineBadge compact />
            </span>
            {s.running ? (
              <Button size="sm" onClick={s.stop} icon={<Square className="size-3.5" />}>
                Stop
              </Button>
            ) : (
              track && (
                <Tip label="Write and verify this audience again">
                  <Button size="sm" variant="ghost" onClick={regenerate} icon={<RotateCw className="size-3.5" />} aria-label="Regenerate">
                    <span className="hidden sm:inline">Regenerate</span>
                  </Button>
                </Tip>
              )
            )}
            <Button size="sm" variant="primary" onClick={() => setAddOpen(true)} disabled={s.running} icon={<Plus className="size-4" />} aria-label="Add audience">
              <span className="hidden sm:inline">Add audience</span>
            </Button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div className="-mb-px flex gap-1 overflow-x-auto" role="tablist" aria-label="Audiences">
            {tracks.map((t) => {
              const o = t.saved && !t.live ? t.saved.receipt.verification.outcome : null;
              const active = track?.key === t.key;
              return (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveKey(t.key)}
                  className={cx('inline-flex shrink-0 items-center gap-2 rounded-t-lg border-b-2 px-3 py-2 text-[13px] font-medium transition-colors', active ? 'border-accent text-text' : 'border-transparent text-text-3 hover:text-text')}
                >
                  {t.live && t.phase !== 'error' ? <Loader2 className="size-3.5 animate-spin text-accent" /> : <span className={cx('size-2 rounded-full', !o ? 'bg-bad' : o === 'clear' ? 'bg-ok' : o === 'review' ? 'bg-warn' : 'bg-bad')} />}
                  {trackLabel(t)}
                </button>
              );
            })}
          </div>
          <nav className="-mb-px flex gap-1 overflow-x-auto" aria-label="Studio views">
            {VIEWS.map((v, i) => (
              <button
                key={v.id}
                onClick={() => setView(v.id)}
                aria-current={view === v.id ? 'page' : undefined}
                className={cx('group inline-flex shrink-0 items-center gap-1.5 border-b-2 px-2.5 py-2 text-[13px] font-medium transition-colors', view === v.id ? 'border-text text-text' : 'border-transparent text-text-3 hover:text-text')}
              >
                {v.label}
                <span className="hidden opacity-0 transition-opacity group-hover:opacity-100 xl:inline">
                  <Kbd>{i + 1}</Kbd>
                </span>
              </button>
            ))}
          </nav>
        </div>
      </header>

      {s.runError && (
        <div role="alert" className="no-print mx-4 mt-4 flex items-start gap-3 rounded-xl border border-bad/25 bg-bad-soft px-4 py-3 text-sm sm:mx-6">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-bad" />
          <div className="flex-1">
            <p className="font-medium">The run could not finish.</p>
            <p className="text-text-2">{s.runError}</p>
          </div>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            Try again
          </Button>
        </div>
      )}

      <div className="flex-1">
        {!track && !s.running ? (
          <div className="p-6">
            <Card>
              <EmptyState icon={<Sparkles className="size-6" />} title="No explanation yet" action={<Button variant="primary" onClick={() => setAddOpen(true)} icon={<Plus className="size-4" />}>Choose an audience</Button>}>
                Choose who this document should be explained to. Each explanation is checked fact by fact against the original.
              </EmptyState>
            </Card>
          </div>
        ) : view === 'studio' ? (
          <div className="p-3 sm:p-5">
            <div className="mb-3 xl:hidden">
              <Segmented label="Panel" value={pane} onChange={setPane} options={[{ value: 'original', label: 'Original' }, { value: 'explanation', label: 'Explanation' }, { value: 'insights', label: 'Insights' }]} />
            </div>
            <div
              className={cx(
                'grid gap-4 xl:h-[calc(100dvh-170px)]',
                insights ? 'xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.2fr)_minmax(320px,0.85fr)]' : 'xl:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)_auto]',
              )}
            >
              <div className={cx('min-h-0 xl:flex xl:flex-col', pane === 'original' ? 'flex h-[75dvh] flex-col xl:h-auto' : 'hidden')}>{original}</div>
              <div className={cx('min-h-0 xl:flex xl:flex-col', pane === 'explanation' ? 'flex h-[75dvh] flex-col xl:h-auto' : 'hidden')}>{explanation}</div>
              <div className={cx('min-h-0 xl:flex xl:flex-col', pane === 'insights' ? 'flex flex-col' : 'hidden')}>
                <div className="mb-2 hidden justify-end xl:flex">
                  <IconButton label={insights ? 'Hide insights' : 'Show insights'} onClick={() => setInsights((o) => !o)}>
                    {insights ? <PanelRightClose className="size-[18px]" /> : <PanelRightOpen className="size-[18px]" />}
                  </IconButton>
                </div>
                {(insights || pane === 'insights') && insightsPanel}
              </div>
            </div>
          </div>
        ) : view === 'meaninglock' ? (
          <MeaningLockView doc={doc} claims={claims} round={streaming ? null : round} decisions={decisions} canReview={canReview} selected={selected} onSelect={setSelected} onReview={review} onUndo={undo} semantic={semantic} />
        ) : view === 'actions' ? (
          <ActionLensView title={display?.title || doc.title} actions={derived.actions} warnings={derived.warnings} unlinked={derived.unlinked} done={saved?.actionsDone ?? []} canEdit={Boolean(saved && !track?.live)} onToggle={toggleAction} onJump={jumpTo} />
        ) : view === 'compare' ? (
          <CompareView doc={doc} tracks={tracks} claims={claims} selected={selected} onSelect={select} />
        ) : (
          <ProofPassView doc={doc} version={track?.live ? null : saved} inventions={saved ? saved.rounds[saved.finalRound].inventions : []} />
        )}
      </div>

      {voiceOpen && display && <VoiceDock voice={voice} onClose={() => (voice.stop(), setVoiceOpen(false))} />}

      {display && model && (
        <div className="print-target hidden print:block" lang={code} dir={rtl ? 'rtl' : 'ltr'}>
          <ExplanationBody model={explanationModel(display, labels, null, [], false)} handlers={{}} definitions={display.definitions} definitionsLabel={labels.definitions} />
          <p style={{ marginTop: 24, fontSize: '10pt' }}>
            {labels.official} · PlainProof {saved?.receipt.receiptId ?? ''} · {saved && saved.review.length ? 'Reviewed by a person' : 'Not reviewed by a person'}
          </p>
        </div>
      )}

      {gloss && (
        <div className="animate-fade-up fixed z-50 max-w-72 rounded-xl bg-text px-3.5 py-2.5 text-[13px] text-bg shadow-pop" style={{ left: gloss.x, top: gloss.y }} role="tooltip">
          <strong className="block">{gloss.term}</strong>
          {gloss.explanation}
          <span className="mt-1 block text-[11px] opacity-60">General meaning, not taken from the document.</span>
        </div>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen} title="Add an audience" description="Each new explanation is written for its audience and checked against the same facts." wide>
        <AudiencePicker value={addSettings} onChange={setAddSettings} />
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setAddOpen(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={startAdd} disabled={!addSettings.profiles.length}>
            Generate
          </Button>
        </div>
      </Dialog>

      {saved && <EditDialog open={editOpen} onOpenChange={setEditOpen} version={saved} onDone={(v) => s.replaceVersion(v)} />}
    </div>
  );
}

function EditDialog({ open, onOpenChange, version, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; version: VersionRow; onDone: (v: VersionRow) => void }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setText(serializeAdapted(version.rounds[version.finalRound].version));
  }, [open, version]);
  const save = async () => {
    setBusy(true);
    try {
      const { version: v } = await api<{ version: VersionRow }>(`/api/versions/${version.id}/verify`, { method: 'POST', body: JSON.stringify({ adapted: text }) });
      onDone(v);
      onOpenChange(false);
      toast(`Your edit was verified: ${v.receipt.verification.outcome === 'clear' ? 'no issues found' : 'see the findings'}.`, v.receipt.verification.outcome === 'clear' ? 'success' : 'info');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Edit the explanation" description="Your edit is checked by the same verifier as any draft, and recorded on the receipt as a human edit. Keep the section markers." wide>
      <textarea value={text} onChange={(e) => setText(e.target.value)} aria-label="Explanation text" spellCheck={false} className="h-[50vh] w-full resize-y rounded-xl border border-border bg-surface-2 p-3 font-mono text-[12.5px] leading-relaxed outline-none focus:border-accent" />
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button variant="primary" onClick={save} loading={busy}>
          Verify my edit
        </Button>
      </div>
    </Dialog>
  );
}
