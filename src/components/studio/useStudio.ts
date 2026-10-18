'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, streamRun, type DocumentRow, type VersionRow } from '@/lib/client/api';
import { parseAdapted } from '@/lib/engine/adapted';
import type { LanguageCode, ProfileId } from '@/lib/engine/profiles';
import type { Adapted, Assessment, ClaimResult, CostSummary, EngineInfo, Fault, Invention, ReviewDecision, Round, RunRequest } from '@/lib/engine/types';

export interface ViewRound {
  round: number;
  kind: Round['kind'];
  version: Adapted;
  fault: Fault | null;
  results: ClaimResult[] | null;
  inventions: Invention[];
  missingTerms: string[];
  assessment: Assessment | null;
}

export type Phase = 'queued' | 'writing' | 'verifying' | 'repairing' | 'done' | 'error';

export interface Live {
  key: string;
  profile: ProfileId;
  language: LanguageCode;
  phase: Phase;
  rounds: ViewRound[];
  text: string;
  repairing: { targets: string[]; problems: number } | null;
  error: string | null;
  reveal: number | null;
}

export interface Track {
  key: string;
  profile: ProfileId;
  language: LanguageCode;
  live: Live | null;
  saved: VersionRow | null;
  rounds: ViewRound[];
  finalRound: number | null;
  phase: Phase;
}

export const trackKey = (profile: string, language: string) => `${profile}:${language}`;

export function useStudio(id: string) {
  const [doc, setDoc] = useState<DocumentRow | null>(null);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [live, setLive] = useState<Record<string, Live>>({});
  const [loadError, setLoadError] = useState<{ message: string; status: number } | null>(null);
  const [running, setRunning] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [cost, setCost] = useState<CostSummary | null>(null);
  const [engine, setEngine] = useState<EngineInfo | null>(null);
  const abort = useRef<AbortController | null>(null);
  const deltas = useRef<Record<string, string>>({});
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<{ document: DocumentRow; versions: VersionRow[] }>(`/api/documents/${id}`);
      setDoc(r.document);
      setVersions(r.versions);
      setLoadError(null);
      return r;
    } catch (err) {
      setLoadError({ message: (err as Error).message, status: (err as { status?: number }).status ?? 0 });
      return null;
    }
  }, [id]);

  useEffect(() => {
    void load();
    return () => abort.current?.abort();
  }, [load]);

  const patchLive = useCallback((key: string, fn: (l: Live) => Live) => setLive((all) => (all[key] ? { ...all, [key]: fn(all[key]) } : all)), []);

  const flushDeltas = useCallback(() => {
    flushTimer.current = null;
    const pending = deltas.current;
    deltas.current = {};
    setLive((all) => {
      const next = { ...all };
      for (const [key, d] of Object.entries(pending)) if (next[key]) next[key] = { ...next[key], text: next[key].text + d };
      return next;
    });
  }, []);

  const run = useCallback(
    async (req: RunRequest) => {
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      setRunning(true);
      setRunError(null);
      setCost(null);
      const fresh: Record<string, Live> = {};
      for (const p of req.profiles) {
        const key = trackKey(p.id, req.language);
        fresh[key] = { key, profile: p.id, language: req.language, phase: 'queued', rounds: [], text: '', repairing: null, error: null, reveal: null };
      }
      setLive((all) => ({ ...all, ...fresh }));
      const keyOf = (profile: string) => trackKey(profile, req.language);

      try {
        for await (const ev of streamRun(id, req, controller.signal)) {
          switch (ev.type) {
            case 'run':
              setEngine(ev.engine);
              break;
            case 'stage':
              setExtracting(ev.status === 'active');
              break;
            case 'claims':
              setDoc((d) => (d ? { ...d, claims: ev.claims, domain: ev.domain, docTitle: ev.title } : d));
              break;
            case 'phase':
              if (flushTimer.current) flushDeltas();
              patchLive(keyOf(ev.profile), (l) => ({
                ...l,
                phase: ev.phase,
                text: ev.phase === 'verifying' ? l.text : '',
                repairing: ev.phase === 'repairing' ? { targets: ev.targets ?? [], problems: ev.problems ?? 0 } : null,
              }));
              break;
            case 'delta': {
              const key = keyOf(ev.profile);
              deltas.current[key] = (deltas.current[key] ?? '') + ev.delta;
              flushTimer.current ??= setTimeout(flushDeltas, 60);
              break;
            }
            case 'draft':
              if (flushTimer.current) flushDeltas();
              patchLive(keyOf(ev.profile), (l) => {
                const rounds = [...l.rounds];
                rounds[ev.round] = { round: ev.round, kind: ev.kind, version: ev.version, fault: ev.fault, results: null, inventions: [], missingTerms: [], assessment: null };
                return { ...l, rounds, text: '' };
              });
              break;
            case 'verified':
              patchLive(keyOf(ev.profile), (l) => {
                const rounds = [...l.rounds];
                rounds[ev.round] = { ...rounds[ev.round], results: ev.results, inventions: ev.inventions, missingTerms: ev.missingTerms, assessment: ev.assessment };
                return { ...l, rounds, reveal: ev.round };
              });
              break;
            case 'final': {
              const key = keyOf(ev.profile);
              const r = await api<{ version: VersionRow }>(`/api/versions/${ev.versionId}`).catch(() => null);
              if (r) {
                setVersions((vs) => [...vs.filter((v) => trackKey(v.profile, v.language) !== key), r.version]);
                patchLive(key, (l) => ({ ...l, phase: 'done' }));
                setLive((all) => {
                  const next = { ...all };
                  delete next[key];
                  return next;
                });
              }
              break;
            }
            case 'version-error':
              patchLive(keyOf(ev.profile), (l) => ({ ...l, phase: 'error', error: ev.message }));
              break;
            case 'error':
              setRunError(ev.message);
              break;
            case 'cost':
            case 'done':
              setCost(ev.cost);
              break;
          }
        }
      } catch (err) {
        if (!controller.signal.aborted) setRunError((err as Error).message);
      } finally {
        if (flushTimer.current) {
          clearTimeout(flushTimer.current);
          flushDeltas();
        }
        setRunning(false);
        setExtracting(false);
        setLive((all) => {
          const next: Record<string, Live> = {};
          for (const [k, l] of Object.entries(all)) {
            if (l.phase === 'done') continue;
            next[k] = { ...l, phase: 'error', error: l.error ?? (controller.signal.aborted ? 'Stopped before it finished.' : 'The run ended before this version was finished.') };
          }
          return next;
        });
        if (abort.current === controller) abort.current = null;
      }
    },
    [id, patchLive, flushDeltas],
  );

  const stop = useCallback(() => abort.current?.abort(), []);
  const dismissLive = useCallback((key: string) => setLive((all) => Object.fromEntries(Object.entries(all).filter(([k]) => k !== key))), []);

  const saveVersion = useCallback(async (versionId: string, patch: { review?: ReviewDecision[]; actionsDone?: string[] }) => {
    setVersions((vs) => vs.map((v) => (v.id === versionId ? { ...v, ...(patch.review ? { review: patch.review } : {}), ...(patch.actionsDone ? { actionsDone: patch.actionsDone } : {}) } : v)));
    const r = await api<{ version: VersionRow }>(`/api/versions/${versionId}`, { method: 'PATCH', body: JSON.stringify(patch) });
    setVersions((vs) => vs.map((v) => (v.id === versionId ? r.version : v)));
  }, []);

  const replaceVersion = useCallback((version: VersionRow) => setVersions((vs) => vs.map((v) => (v.id === version.id ? version : v))), []);

  const tracks = useMemo<Track[]>(() => {
    const map = new Map<string, Track>();
    for (const v of versions) {
      const rounds: ViewRound[] = v.rounds.map((r) => ({ ...r, results: r.results, assessment: r.assessment }));
      map.set(trackKey(v.profile, v.language), { key: trackKey(v.profile, v.language), profile: v.profile, language: v.language, live: null, saved: v, rounds, finalRound: v.finalRound, phase: 'done' });
    }
    for (const l of Object.values(live)) {
      map.set(l.key, { key: l.key, profile: l.profile, language: l.language, live: l, saved: map.get(l.key)?.saved ?? null, rounds: l.rounds, finalRound: null, phase: l.phase });
    }
    return [...map.values()];
  }, [versions, live]);

  return { doc, setDoc, versions, tracks, loadError, running, extracting, runError, cost, engine, run, stop, load, saveVersion, replaceVersion, dismissLive };
}

export function streamingVersion(track: Track): Adapted | null {
  const l = track.live;
  if (!l || !l.text || (l.phase !== 'writing' && l.phase !== 'repairing')) return null;
  return parseAdapted(l.text);
}
