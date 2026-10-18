'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowRight, ShieldCheck, ListChecks, AudioLines, Users, FileSearch, Languages } from 'lucide-react';
import { Logo, EngineBadge, ThemeToggle } from '@/components/shell';
import { Uploader } from '@/components/intake';
import { Button } from '@/components/ui';
import { useToast } from '@/components/providers';
import { api, type UploadResult } from '@/lib/client/api';

const FEATURES = [
  { icon: ShieldCheck, name: 'MeaningLock', text: 'Every date, amount, warning and exception is extracted first, then checked in the explanation by an independent verifier.' },
  { icon: Users, name: 'AudienceDNA', text: 'Wording, structure and depth change for a teen, a senior or a language learner. The facts do not.' },
  { icon: ListChecks, name: 'ActionLens', text: 'Deadlines, payments and next steps become a checklist, each linked to the paragraph it came from.' },
  { icon: AudioLines, name: 'VoiceSync', text: 'Listen to the explanation, with each sentence highlighted as it is read.' },
  { icon: FileSearch, name: 'ProofPass', text: 'A receipt of what was checked, what was flagged, and what still needs a person.' },
  { icon: Languages, name: 'Arabic and Tamil', text: 'Explanations in English, Arabic or Tamil, verified against the original document.' },
];

export default function Landing() {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const go = (r: UploadResult) => router.push(`/new?doc=${r.document.id}&step=personalize`);
  const sample = async () => {
    setBusy(true);
    try {
      go(await api<UploadResult>('/api/documents', { method: 'POST', body: JSON.stringify({ sample: 'insurance' }) }));
    } catch (err) {
      toast((err as Error).message, 'error');
      setBusy(false);
    }
  };

  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
        <Logo />
        <nav className="flex items-center gap-1 sm:gap-2">
          <span className="hidden md:inline-flex">
            <EngineBadge />
          </span>
          <Link href="/library" className="rounded-lg px-3 py-2 text-sm font-medium text-text-2 hover:text-text">
            Library
          </Link>
          <ThemeToggle />
        </nav>
      </header>

      <main id="main">
        <section className="mx-auto max-w-6xl px-5 pb-16 pt-12 sm:px-8 sm:pt-20">
          <div className="mx-auto max-w-3xl text-center">
            <p className="animate-fade-up text-[13px] font-semibold uppercase tracking-[0.14em] text-accent">Understanding, with receipts</p>
            <h1 className="animate-fade-up mt-4 font-display text-[44px] font-extrabold leading-[1.02] tracking-[-0.035em] sm:text-[68px]" style={{ animationDelay: '60ms' }}>
              Your documents.
              <br />
              Finally understood.
            </h1>
            <p className="animate-fade-up mx-auto mt-6 max-w-xl text-lg leading-relaxed text-text-2" style={{ animationDelay: '120ms' }}>
              Turn complex information into clear, personalized explanations, with evidence you can inspect.
            </p>
            <div className="animate-fade-up mt-8 flex flex-wrap justify-center gap-3" style={{ animationDelay: '180ms' }}>
              <Link href="/new">
                <Button variant="primary" size="lg" icon={<ArrowRight className="size-4" />}>
                  Understand a document
                </Button>
              </Link>
              <Button size="lg" onClick={sample} loading={busy}>
                Explore a sample
              </Button>
            </div>
          </div>

          <div className="animate-fade-up mx-auto mt-14 max-w-2xl" style={{ animationDelay: '240ms' }}>
            <Uploader onCreated={go} compact />
          </div>
        </section>

        <section className="border-y border-border bg-surface/60">
          <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
            <div className="grid items-center gap-12 lg:grid-cols-[1fr_1.2fr]">
              <div>
                <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Different explanations. Shared evidence.</h2>
                <p className="mt-4 text-lg leading-relaxed text-text-2">
                  PlainProof does not just make text shorter. It writes for the person in front of it, then checks every important fact against the original, and shows you where each one came from.
                </p>
                <ol className="mt-8 space-y-4 text-[15px]">
                  {[
                    ['Upload', 'PDF, Word, text, or a photo of a letter.'],
                    ['Personalize', 'Choose the audience and the language.'],
                    ['Understand, verify, share', 'Read it, inspect the evidence, export the receipt.'],
                  ].map(([t, d], i) => (
                    <li key={t} className="flex gap-4">
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[13px] font-semibold text-accent">{i + 1}</span>
                      <span>
                        <strong className="font-semibold">{t}.</strong> <span className="text-text-2">{d}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
              <Illustration />
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
          <div className="grid gap-x-10 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, name, text }) => (
              <div key={name}>
                <Icon className="size-6 text-accent" />
                <h3 className="mt-4 font-display text-[17px] font-semibold">{name}</h3>
                <p className="mt-2 leading-relaxed text-text-2">{text}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-8 text-sm text-text-3 sm:px-8">
          <span>PlainProof checks explanations automatically. The original document is always the official source.</span>
          <span>Built for the AMD Developer Hackathon · ACT III</span>
        </div>
      </footer>
    </div>
  );
}

// A static, labelled illustration of the studio: the same fact linked in two explanations and the original.
function Illustration() {
  return (
    <figure className="relative" aria-label="Illustration of a fact linked across the original and two explanations">
      <div className="rounded-3xl border border-border bg-surface p-5 shadow-card">
        <div className="rounded-2xl bg-bg-subtle p-4 text-[13px] leading-relaxed text-text-2">
          <span className="mb-1 block font-mono text-[10.5px] text-text-3">¶5 · ORIGINAL</span>
          You must submit your updated contact and bank details through the member portal or by post <span className="mark is-selected">no later than 25 October 2026</span>.
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-border p-4">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">Teen</span>
            <p className="mt-2 text-[14px] leading-relaxed">
              Update your contact and bank details <span className="mark is-selected">by 25 October 2026</span>. You can do it online or by post.
            </p>
          </div>
          <div className="rounded-2xl border border-border p-4">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">Senior</span>
            <p className="mt-2 text-[15px] leading-relaxed">
              1. Send your new contact and bank details. Please do this <span className="mark is-selected">no later than 25 October 2026</span>.
            </p>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-2 text-[12.5px]">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-ok-soft px-2.5 py-1 font-medium text-ok">
            <span className="size-1.5 rounded-full bg-ok" /> Matched in both
          </span>
          <span className="text-text-3">deadline · critical</span>
        </div>
      </div>
      <figcaption className="mt-3 text-center text-xs text-text-3">Illustration. In the app, these links come from the verifier&apos;s findings.</figcaption>
    </figure>
  );
}
