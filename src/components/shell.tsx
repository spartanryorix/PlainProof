'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { FilePlus2, Library, Menu, Moon, Settings, Sun, Cpu, FlaskConical, X, Keyboard } from 'lucide-react';
import { api, type LibraryItem } from '@/lib/client/api';
import { useHealth, usePrefs } from './providers';
import { cx, Dialog, Kbd, Tip } from './ui';

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-2.5', className)}>
      <svg viewBox="0 0 32 32" className="size-7" aria-hidden>
        <rect width="32" height="32" rx="9" className="fill-accent" />
        <path d="M10 9.5h8.2a5 5 0 0 1 0 10H14v3" fill="none" stroke="var(--accent-fg)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="21.5" cy="23" r="2.2" fill="var(--ok-line)" />
      </svg>
      <span className="font-display text-[17px] font-bold tracking-tight">PlainProof</span>
    </span>
  );
}

export function EngineBadge({ compact }: { compact?: boolean }) {
  const health = useHealth();
  if (!health) return <span className="skeleton inline-block h-6 w-32" />;
  if (health.mode === 'preview') {
    return (
      <Tip label="No AI model is connected. Explanations use rule-based rewording and the checks are lexical only, not semantic. Connect the vLLM endpoint on AMD for real results.">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-warn/30 bg-warn-soft px-2.5 py-1 text-xs font-medium text-warn">
          <FlaskConical className="size-3.5" />
          Preview Mode{compact ? '' : ' · no AI model'}
        </span>
      </Tip>
    );
  }
  return (
    <Tip label={`Writer: ${health.writerModel}. Verifier: ${health.verifierModel}. Endpoint: ${health.endpoint}.`}>
      <span className="inline-flex max-w-full items-center gap-1.5 truncate rounded-full border border-ok/30 bg-ok-soft px-2.5 py-1 text-xs font-medium text-ok">
        <Cpu className="size-3.5 shrink-0" />
        <span className="truncate">{compact ? 'AMD inference' : health.hardware}</span>
      </span>
    </Tip>
  );
}

const NAV = [
  { href: '/new', label: 'New document', icon: FilePlus2, keys: 'G N' },
  { href: '/library', label: 'Library', icon: Library, keys: 'G L' },
  { href: '/settings', label: 'Settings', icon: Settings, keys: 'G S' },
];

export const SHORTCUTS: [string, string][] = [
  ['?', 'Show keyboard shortcuts'],
  ['G then N', 'New document'],
  ['G then L', 'Library'],
  ['G then S', 'Settings'],
  ['T', 'Switch light and dark theme'],
  ['1 to 5', 'Studio views: Studio, MeaningLock, ActionLens, Compare, ProofPass'],
  ['J / K', 'Next / previous fact'],
  ['Space', 'Play or pause VoiceSync'],
  ['Esc', 'Clear the selected fact'],
];

function useGlobalShortcuts(openHelp: () => void) {
  const router = useRouter();
  const { prefs, setPrefs } = usePrefs();
  const pending = useRef<string | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || t.closest('input, textarea, select, [contenteditable="true"]')) return;
      const k = e.key.toLowerCase();
      if (pending.current === 'g') {
        pending.current = null;
        const to = { n: '/new', l: '/library', s: '/settings' }[k];
        if (to) {
          e.preventDefault();
          router.push(to);
        }
        return;
      }
      if (k === 'g') {
        pending.current = 'g';
        setTimeout(() => (pending.current = null), 900);
      } else if (e.key === '?') {
        e.preventDefault();
        openHelp();
      } else if (k === 't') {
        const dark = document.documentElement.dataset.theme === 'dark';
        setPrefs({ theme: dark ? 'light' : 'dark' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router, setPrefs, openHelp, prefs.theme]);
}

export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Keyboard shortcuts">
      <dl className="divide-y divide-border">
        {SHORTCUTS.map(([keys, what]) => (
          <div key={keys} className="flex items-center justify-between gap-6 py-2.5 text-sm">
            <dt className="text-text-2">{what}</dt>
            <dd className="flex gap-1">
              {keys.split(' ').map((k, i) => (k === 'then' || k === 'to' || k === '/' ? <span key={i} className="px-1 text-xs text-text-3">{k}</span> : <Kbd key={i}>{k}</Kbd>))}
            </dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}

export function ThemeToggle() {
  const { setPrefs } = usePrefs();
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.dataset.theme === 'dark'), []);
  return (
    <button
      onClick={() => {
        setPrefs({ theme: dark ? 'light' : 'dark' });
        setDark(!dark);
      }}
      className="inline-flex size-9 items-center justify-center rounded-lg text-text-2 hover:bg-bg-subtle hover:text-text"
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      {dark ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
    </button>
  );
}

export function WorkspaceShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [recent, setRecent] = useState<LibraryItem[]>([]);
  const [menu, setMenu] = useState(false);
  const [help, setHelp] = useState(false);
  useGlobalShortcuts(() => setHelp(true));

  useEffect(() => {
    api<{ documents: LibraryItem[] }>('/api/documents').then((r) => setRecent(r.documents.slice(0, 6)), () => {});
    setMenu(false);
  }, [pathname]);

  const nav = (
    <nav className="flex h-full flex-col gap-1 p-3" aria-label="Workspace">
      <Link href="/" className="mb-4 rounded-lg px-2 py-1.5">
        <Logo />
      </Link>
      {NAV.map(({ href, label, icon: Icon, keys }) => {
        const active = pathname === href || (href === '/library' && pathname.startsWith('/d/'));
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cx(
              'group flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors',
              active ? 'bg-surface text-text shadow-soft ring-1 ring-border' : 'text-text-2 hover:bg-surface hover:text-text',
            )}
          >
            <Icon className="size-[18px]" />
            <span className="flex-1">{label}</span>
            <span className="hidden text-[10px] tracking-wider text-text-3 group-hover:inline">{keys}</span>
          </Link>
        );
      })}
      {recent.length > 0 && (
        <div className="mt-6">
          <p className="px-2.5 pb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">Recent</p>
          {recent.map((d) => (
            <Link
              key={d.id}
              href={`/d/${d.id}`}
              className={cx(
                'block truncate rounded-lg px-2.5 py-1.5 text-[13px] transition-colors',
                pathname === `/d/${d.id}` ? 'bg-surface text-text ring-1 ring-border' : 'text-text-2 hover:bg-surface hover:text-text',
              )}
            >
              {d.title}
            </Link>
          ))}
        </div>
      )}
      <div className="mt-auto flex flex-col gap-2 border-t border-border pt-3">
        <EngineBadge />
        <div className="flex items-center justify-between">
          <ThemeToggle />
          <button onClick={() => setHelp(true)} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-text-3 hover:bg-bg-subtle hover:text-text">
            <Keyboard className="size-4" /> Shortcuts <Kbd>?</Kbd>
          </button>
        </div>
      </div>
    </nav>
  );

  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 border-e border-border bg-bg-subtle lg:block">{nav}</aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-bg/85 px-4 backdrop-blur lg:hidden">
          <Link href="/">
            <Logo />
          </Link>
          <button className="inline-flex size-10 items-center justify-center rounded-lg hover:bg-bg-subtle" aria-label="Open menu" onClick={() => setMenu(true)}>
            <Menu className="size-5" />
          </button>
        </header>
        {menu && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div className="absolute inset-0 bg-black/40" onClick={() => setMenu(false)} />
            <aside className="animate-fade-up absolute inset-y-0 start-0 w-72 border-e border-border bg-bg-subtle">
              <button className="absolute end-3 top-3 rounded-lg p-2 hover:bg-surface" aria-label="Close menu" onClick={() => setMenu(false)}>
                <X className="size-5" />
              </button>
              {nav}
            </aside>
          </div>
        )}
        <main id="main" className="min-w-0 flex-1">
          {children}
        </main>
      </div>
      <ShortcutsDialog open={help} onOpenChange={setHelp} />
    </div>
  );
}
