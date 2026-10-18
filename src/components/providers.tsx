'use client';

import * as Tooltip from '@radix-ui/react-tooltip';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';
import { api, type Health } from '@/lib/client/api';

// ---------- preferences (theme, motion, reader, voice) ----------

export interface Prefs {
  theme: 'system' | 'light' | 'dark';
  motion: 'system' | 'reduce' | 'full';
  readerFont: 'default' | 'lexend' | 'atkinson';
  readerSize: 'normal' | 'large' | 'xl';
  readerSpacing: 'normal' | 'wide';
  lineFocus: boolean;
  voiceRate: number;
  voiceName: string;
  reviewer: string;
}

export const DEFAULT_PREFS: Prefs = {
  theme: 'system',
  motion: 'system',
  readerFont: 'default',
  readerSize: 'normal',
  readerSpacing: 'normal',
  lineFocus: false,
  voiceRate: 1,
  voiceName: '',
  reviewer: '',
};

const KEY = 'pp.prefs';

function load(): Prefs {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return DEFAULT_PREFS;
  }
}

function applyTheme(p: Prefs) {
  const dark = p.theme === 'dark' || (p.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  if (p.motion === 'system') delete document.documentElement.dataset.motion;
  else document.documentElement.dataset.motion = p.motion;
}

// Runs before React hydrates, so the page never flashes the wrong theme.
export const themeScript = `(function(){try{var p=JSON.parse(localStorage.getItem('${KEY}')||'{}');var t=p.theme||'system';var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light';if(p.motion&&p.motion!=='system')document.documentElement.dataset.motion=p.motion;}catch(e){document.documentElement.dataset.theme='light';}})();`;

const PrefsContext = createContext<{ prefs: Prefs; setPrefs: (patch: Partial<Prefs>) => void; ready: boolean }>({
  prefs: DEFAULT_PREFS,
  setPrefs: () => {},
  ready: false,
});

export const usePrefs = () => useContext(PrefsContext);

// ---------- toasts ----------

type ToastKind = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

const ToastContext = createContext<(message: string, kind?: ToastKind) => void>(() => {});
export const useToast = () => useContext(ToastContext);

// ---------- health ----------

const HealthContext = createContext<Health | null>(null);
export const useHealth = () => useContext(HealthContext);

export function Providers({ children }: { children: ReactNode }) {
  const [prefs, setPrefsState] = useState<Prefs>(DEFAULT_PREFS);
  const [ready, setReady] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    const p = load();
    setPrefsState(p);
    setReady(true);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme(load());
    mq.addEventListener('change', onChange);
    api<Health>('/api/health').then(setHealth, () => setHealth(null));
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const setPrefs = useCallback((patch: Partial<Prefs>) => {
    setPrefsState((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* storage unavailable: keep for this session only */
      }
      applyTheme(next);
      return next;
    });
  }, []);

  const toast = useCallback((message: string, kind: ToastKind = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, kind, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 3500);
  }, []);

  const prefsValue = useMemo(() => ({ prefs, setPrefs, ready }), [prefs, setPrefs, ready]);

  return (
    <PrefsContext.Provider value={prefsValue}>
      <HealthContext.Provider value={health}>
        <ToastContext.Provider value={toast}>
          <Tooltip.Provider delayDuration={250} skipDelayDuration={100}>
            {children}
            <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4" aria-live="polite" role="status">
              {toasts.map((t) => (
                <div
                  key={t.id}
                  className={`animate-fade-up pointer-events-auto flex max-w-md items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-pop ${
                    t.kind === 'error' ? 'border-bad/30 bg-surface text-text' : 'border-border bg-surface text-text'
                  }`}
                >
                  {t.kind === 'success' ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" /> : t.kind === 'error' ? <AlertTriangle className="mt-0.5 size-4 shrink-0 text-bad" /> : <Info className="mt-0.5 size-4 shrink-0 text-accent" />}
                  <span className="flex-1">{t.message}</span>
                  <button className="text-text-3 hover:text-text" aria-label="Dismiss" onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))}>
                    <X className="size-4" />
                  </button>
                </div>
              ))}
            </div>
          </Tooltip.Provider>
        </ToastContext.Provider>
      </HealthContext.Provider>
    </PrefsContext.Provider>
  );
}
