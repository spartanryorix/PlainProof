'use client';

// VoiceSync: narration of the actual explanation, sentence by sentence, with highlighting.
// A neural voice service is used when one is configured for the language; otherwise the
// browser's own voices, labelled as such. Unsupported languages are said so plainly.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, Square, Volume2, X, AudioLines } from 'lucide-react';
import { cx, IconButton } from '@/components/ui';
import { useHealth, usePrefs } from '@/components/providers';
import type { Profile } from '@/lib/engine/profiles';

export interface VoiceState {
  status: 'idle' | 'loading' | 'playing' | 'paused';
  index: number;
  speaking: number | null;
  engine: 'neural' | 'browser' | 'none';
  engineLabel: string;
  problem: string | null;
}

interface Options {
  sentences: { index: number; text: string }[];
  bcp: string;
  langCode: string;
  profile: Profile;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function useVoiceSync({ sentences, bcp, langCode, profile }: Options) {
  const health = useHealth();
  const { prefs, setPrefs } = usePrefs();
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [status, setStatus] = useState<VoiceState['status']>('idle');
  const [index, setIndex] = useState(0);
  const token = useRef(0);
  const audio = useRef<HTMLAudioElement | null>(null);
  const cache = useRef(new Map<string, Promise<string>>());
  const rate = prefs.voiceRate * profile.voice.rate;

  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const update = () => setVoices(window.speechSynthesis.getVoices());
    update();
    window.speechSynthesis.addEventListener('voiceschanged', update);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', update);
  }, []);

  const neural = Boolean(health?.tts.available && health.tts.languages?.includes(langCode));
  const langVoices = useMemo(() => voices.filter((v) => v.lang.toLowerCase().startsWith(bcp.slice(0, 2).toLowerCase())), [voices, bcp]);
  const browserVoice = langVoices.find((v) => v.name === prefs.voiceName) ?? langVoices.find((v) => v.lang === bcp) ?? langVoices[0] ?? null;
  const neuralVoices = health?.tts.voices ?? [];
  const neuralVoice = neuralVoices.includes(prefs.voiceName) ? prefs.voiceName : neuralVoices[0];
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const engine: VoiceState['engine'] = neural ? 'neural' : browserVoice ? 'browser' : 'none';
  const languageName = langCode === 'ar' ? 'Arabic' : langCode === 'ta' ? 'Tamil' : 'this language';
  const problem =
    engine !== 'none'
      ? null
      : !supported
        ? 'This browser cannot read text aloud. Try a current version of Chrome, Edge or Safari, or connect a neural voice service.'
        : voices.length === 0
          ? 'No voices are available in this browser yet.'
          : `No ${languageName} voice is installed in this browser. Add one in your system's speech settings, or connect a neural voice service.`;
  const engineLabel = engine === 'neural' ? `${health?.tts.label ?? 'Neural voice'} · ${neuralVoice}` : engine === 'browser' ? `Browser voice · ${browserVoice!.name}` : 'No voice available';

  const stop = useCallback(() => {
    token.current++;
    window.speechSynthesis?.cancel();
    audio.current?.pause();
    setStatus('idle');
  }, []);

  useEffect(() => stop, [stop]);
  useEffect(() => {
    stop();
    setIndex(0);
  }, [sentences, stop]);

  const fetchAudio = useCallback(
    (text: string) => {
      const key = `${neuralVoice}|${rate}|${text}`;
      if (!cache.current.has(key)) {
        cache.current.set(
          key,
          fetch('/api/tts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, voice: neuralVoice, speed: Math.min(2, Math.max(0.5, rate)) }) }).then(async (r) => {
            if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'The voice service failed.');
            return URL.createObjectURL(await r.blob());
          }),
        );
      }
      return cache.current.get(key)!;
    },
    [neuralVoice, rate],
  );

  const speakFrom = useCallback(
    async (start: number) => {
      if (engine === 'none' || !sentences.length) return;
      window.speechSynthesis?.cancel();
      audio.current?.pause();
      const my = ++token.current;
      for (let i = start; i < sentences.length; i++) {
        if (my !== token.current) return;
        setIndex(i);
        const text = sentences[i].text;
        if (engine === 'neural') {
          setStatus('loading');
          let url: string;
          try {
            url = await fetchAudio(text);
            if (i + 1 < sentences.length) void fetchAudio(sentences[i + 1].text).catch(() => {});
          } catch {
            if (my === token.current) setStatus('idle');
            return;
          }
          if (my !== token.current) return;
          const el = (audio.current ??= new Audio());
          el.src = url;
          el.playbackRate = 1;
          setStatus('playing');
          await new Promise<void>((resolve) => {
            el.onended = () => resolve();
            el.onerror = () => resolve();
            el.play().catch(() => resolve());
          });
        } else {
          setStatus('playing');
          await new Promise<void>((resolve) => {
            const u = new SpeechSynthesisUtterance(text);
            u.lang = browserVoice!.lang;
            u.voice = browserVoice;
            u.rate = rate;
            u.pitch = profile.voice.pitch;
            u.onend = () => resolve();
            u.onerror = () => resolve();
            window.speechSynthesis.speak(u);
          });
        }
        if (my !== token.current) return;
        await sleep(profile.voice.pauseMs);
      }
      if (my === token.current) {
        setStatus('idle');
        setIndex(0);
      }
    },
    [engine, sentences, fetchAudio, browserVoice, rate, profile],
  );

  const play = useCallback(() => {
    if (status === 'paused') {
      if (engine === 'neural') void audio.current?.play();
      else window.speechSynthesis.resume();
      setStatus('playing');
      return;
    }
    void speakFrom(index);
  }, [status, engine, index, speakFrom]);

  const pause = useCallback(() => {
    if (engine === 'neural') audio.current?.pause();
    else window.speechSynthesis.pause();
    setStatus('paused');
  }, [engine]);

  const toggle = useCallback(() => (status === 'playing' || status === 'loading' ? pause() : play()), [status, pause, play]);
  const seek = useCallback((i: number) => void speakFrom(i), [speakFrom]);

  return {
    state: { status, index, speaking: status === 'idle' ? null : (sentences[index]?.index ?? null), engine, engineLabel, problem } as VoiceState,
    play,
    pause,
    stop,
    toggle,
    seek,
    total: sentences.length,
    rate: prefs.voiceRate,
    setRate: (r: number) => setPrefs({ voiceRate: r }),
    voiceOptions: engine === 'neural' ? neuralVoices : langVoices.map((v) => v.name),
    voiceName: engine === 'neural' ? neuralVoice : (browserVoice?.name ?? ''),
    setVoice: (name: string) => setPrefs({ voiceName: name }),
  };
}

export type VoiceSyncApi = ReturnType<typeof useVoiceSync>;

export function VoiceDock({ voice, onClose }: { voice: VoiceSyncApi; onClose: () => void }) {
  const { state, total } = voice;
  const playing = state.status === 'playing' || state.status === 'loading';
  return (
    <div className="no-print animate-fade-up sticky bottom-3 z-30 mx-3 mt-3 rounded-2xl border border-border bg-surface/95 p-3 shadow-pop backdrop-blur sm:mx-auto sm:max-w-3xl" role="region" aria-label="VoiceSync player">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <button
            onClick={voice.toggle}
            disabled={state.engine === 'none'}
            aria-label={playing ? 'Pause' : state.status === 'paused' ? 'Resume' : 'Play'}
            className="inline-flex size-11 items-center justify-center rounded-full bg-accent text-accent-fg shadow-soft transition hover:bg-accent-hover disabled:opacity-40"
          >
            {playing ? <Pause className="size-5" /> : <Play className="ms-0.5 size-5" />}
          </button>
          <IconButton label="Stop" onClick={voice.stop} disabled={state.status === 'idle'}>
            <Square className="size-4" />
          </IconButton>
        </div>
        <div className="min-w-40 flex-1">
          <div className="flex items-center justify-between text-[11.5px] text-text-3">
            <span className="inline-flex items-center gap-1.5 truncate">
              {state.engine === 'neural' ? <AudioLines className="size-3.5 text-accent" /> : <Volume2 className="size-3.5" />}
              {state.engineLabel}
            </span>
            <span className="tabular-nums">{total ? `${Math.min(state.index + 1, total)} / ${total}` : '0 / 0'}</span>
          </div>
          <div className="mt-1.5 flex h-2 gap-px overflow-hidden rounded-full bg-bg-subtle" role="group" aria-label="Sentences">
            {Array.from({ length: total }, (_, i) => (
              <button
                key={i}
                aria-label={`Play from sentence ${i + 1}`}
                onClick={() => voice.seek(i)}
                className={cx('h-full flex-1 transition-colors', i < state.index || (i === state.index && state.status !== 'idle') ? 'bg-accent' : 'hover:bg-border-strong')}
              />
            ))}
          </div>
        </div>
        <label className="flex items-center gap-1.5 text-xs text-text-2">
          Speed
          <select value={voice.rate} onChange={(e) => voice.setRate(Number(e.target.value))} className="h-8 rounded-lg border border-border bg-surface px-1.5 text-xs">
            {[0.75, 0.9, 1, 1.15, 1.3, 1.5].map((r) => (
              <option key={r} value={r}>
                {r}×
              </option>
            ))}
          </select>
        </label>
        {voice.voiceOptions.length > 1 && (
          <label className="flex items-center gap-1.5 text-xs text-text-2">
            Voice
            <select value={voice.voiceName} onChange={(e) => voice.setVoice(e.target.value)} className="h-8 max-w-40 rounded-lg border border-border bg-surface px-1.5 text-xs">
              {voice.voiceOptions.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
        )}
        <IconButton label="Close player" onClick={onClose}>
          <X className="size-4" />
        </IconButton>
      </div>
      {state.problem && <p className="mt-2 text-xs text-warn">{state.problem}</p>}
    </div>
  );
}
