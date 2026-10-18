'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { FileText, Search, Trash2, FilePlus2, Library as LibraryIcon } from 'lucide-react';
import { api, timeAgo, type LibraryItem } from '@/lib/client/api';
import { PROFILES, languageOf } from '@/lib/engine/profiles';
import { Button, Card, cx, Dialog, EmptyState, IconButton, Skeleton, Tip } from '@/components/ui';
import { useHealth, useToast } from '@/components/providers';

const OUTCOME_DOT: Record<string, string> = { clear: 'bg-ok', review: 'bg-warn', issues: 'bg-bad' };
const OUTCOME_TEXT: Record<string, string> = { clear: 'No issues found', review: 'Needs review', issues: 'Issues found' };

export default function LibraryPage() {
  const toast = useToast();
  const health = useHealth();
  const [docs, setDocs] = useState<LibraryItem[] | null>(null);
  const [q, setQ] = useState('');
  const [confirm, setConfirm] = useState<LibraryItem | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      api<{ documents: LibraryItem[] }>(`/api/documents?q=${encodeURIComponent(q)}`)
        .then((r) => setDocs(r.documents))
        .catch((e) => toast((e as Error).message, 'error'));
    }, q ? 200 : 0);
    return () => clearTimeout(t);
  }, [q, toast]);

  const remove = async (d: LibraryItem) => {
    try {
      await api(`/api/documents/${d.id}`, { method: 'DELETE' });
      setDocs((all) => all?.filter((x) => x.id !== d.id) ?? null);
      toast(`Deleted “${d.title}”.`, 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
    setConfirm(null);
  };

  const count = useMemo(() => docs?.length ?? 0, [docs]);

  return (
    <div className="mx-auto max-w-5xl px-5 py-8 sm:px-8 sm:py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">Library</h1>
          <p className="mt-1 text-sm text-text-2">
            {docs ? `${count} document${count === 1 ? '' : 's'}.` : ''} Documents are deleted automatically after {health?.retentionHours ?? 72} hours.
          </p>
        </div>
        <Link href="/new">
          <Button variant="primary" icon={<FilePlus2 className="size-4" />}>
            New document
          </Button>
        </Link>
      </div>

      <div className="relative mt-8">
        <Search className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-text-3" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by title or file name"
          aria-label="Search documents"
          className="h-11 w-full rounded-xl border border-border bg-surface ps-10 pe-4 text-sm outline-none focus:border-accent focus:ring-4 focus:ring-[var(--accent-ring)]"
        />
      </div>

      <div className="mt-6">
        {!docs ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-20 w-full rounded-2xl" />
            ))}
          </div>
        ) : docs.length === 0 ? (
          <Card>
            <EmptyState
              icon={q ? <Search className="size-6" /> : <LibraryIcon className="size-6" />}
              title={q ? 'No documents match' : 'Your library is empty'}
              action={!q && <Link href="/new"><Button variant="primary">Add your first document</Button></Link>}
            >
              {q ? 'Try a different word.' : 'Documents you upload appear here, with every explanation and receipt.'}
            </EmptyState>
          </Card>
        ) : (
          <ul className="space-y-2.5">
            {docs.map((d) => (
              <li key={d.id}>
                <Card className="group flex items-center gap-4 p-4 transition-colors hover:border-border-strong">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-bg-subtle text-text-2">
                    <FileText className="size-5" />
                  </div>
                  <Link href={`/d/${d.id}`} className="min-w-0 flex-1 outline-none after:absolute after:inset-0 relative">
                    <p className="truncate font-medium">{d.title}</p>
                    <p className="mt-0.5 truncate text-[12.5px] text-text-3">
                      {[d.filename, `${d.words.toLocaleString()} words`, d.domain, `updated ${timeAgo(d.updatedAt)}`].filter(Boolean).join(' · ')}
                    </p>
                  </Link>
                  <div className="hidden flex-wrap justify-end gap-1.5 sm:flex">
                    {d.versions.length === 0 ? (
                      <span className="text-xs text-text-3">No explanation yet</span>
                    ) : (
                      d.versions.map((v) => (
                        <Tip key={v.id} label={`${OUTCOME_TEXT[v.outcome]}${v.semantic ? '' : ' (lexical check)'}`}>
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-[11.5px] text-text-2">
                            <span className={cx('size-1.5 rounded-full', OUTCOME_DOT[v.outcome])} />
                            {PROFILES[v.profile].short}
                            {v.language !== 'en' && ` · ${v.language === 'source' ? 'orig.' : languageOf(v.language).name}`}
                          </span>
                        </Tip>
                      ))
                    )}
                  </div>
                  <IconButton label={`Delete ${d.title}`} onClick={() => setConfirm(d)} className="relative z-10">
                    <Trash2 className="size-4" />
                  </IconButton>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Dialog open={Boolean(confirm)} onOpenChange={(o) => !o && setConfirm(null)} title="Delete this document?" description="The extracted text, every explanation, review decision and receipt will be deleted. This cannot be undone.">
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirm(null)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => confirm && remove(confirm)}>
            Delete
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
