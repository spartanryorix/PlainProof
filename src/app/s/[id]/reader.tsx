'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { AudioLines, CheckCircle2, AlertTriangle, XCircle, FlaskConical } from 'lucide-react';
import { ExplanationBody, explanationModel } from '@/components/doc/annotate';
import { useVoiceSync, VoiceDock } from '@/components/studio/voice';
import { Popover, ReaderControls } from '@/components/studio/panels';
import { Logo, ThemeToggle } from '@/components/shell';
import { Button, cx, IconButton, OUTCOME_STYLE } from '@/components/ui';
import { usePrefs } from '@/components/providers';
import { languageOf, type Labels, type Profile } from '@/lib/engine/profiles';
import type { Adapted, ClaimResult, Invention, Outcome } from '@/lib/engine/types';
import { Settings2 } from 'lucide-react';

interface ReceiptSummary {
  id: string;
  outcome: Outcome;
  matched: number;
  total: number;
  semantic: boolean;
  statement: string;
  review: 'not-reviewed' | 'partially-reviewed' | 'reviewed';
  unresolved: number;
  official: string | null;
  audience: string;
  language: string;
  document: string;
}

export function ShareReader(props: {
  version: Adapted;
  results: ClaimResult[];
  inventions: Invention[];
  labels: Labels;
  labelsCode: string;
  rtl: boolean;
  profile: Profile;
  receipt: ReceiptSummary;
  footer: ReactNode;
}) {
  const { prefs } = usePrefs();
  const [showEvidence, setShowEvidence] = useState(false);
  const [listening, setListening] = useState(false);
  const model = useMemo(
    () => explanationModel(props.version, props.labels, showEvidence ? props.results : null, showEvidence ? props.inventions : []),
    [props.version, props.labels, props.results, props.inventions, showEvidence],
  );
  const plain = useMemo(() => ({ ...model, blocks: model.blocks.map((b) => (showEvidence ? b : { ...b, marks: b.marks.filter((m) => m.gloss) })) }), [model, showEvidence]);
  const sentences = useMemo(() => model.sentences, [model]);
  const voice = useVoiceSync({ sentences, bcp: languageOf(props.labelsCode).bcp, langCode: props.labelsCode, profile: props.profile });
  const r = props.receipt;
  const o = OUTCOME_STYLE[r.outcome];
  const Icon = r.outcome === 'clear' ? CheckCircle2 : r.outcome === 'review' ? AlertTriangle : XCircle;

  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-5 py-5">
        <Logo />
        <ThemeToggle />
      </header>
      <main id="main" className="mx-auto max-w-3xl px-5 pb-16">
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-surface p-4 shadow-soft">
          <span className={cx('inline-flex size-9 items-center justify-center rounded-xl', o.soft, o.text)}>
            <Icon className="size-5" />
          </span>
          <div className="min-w-0 flex-1 text-sm">
            <p className={cx('font-semibold', o.text)}>
              {o.label}
              {!r.semantic && <span className="ms-1.5 text-xs font-medium text-text-3">lexical check</span>}
            </p>
            <p className="text-text-2">
              {r.matched} of {r.total} facts from the original matched · {r.review === 'not-reviewed' ? 'not reviewed by a person' : r.review === 'reviewed' ? 'reviewed by a person' : 'partially reviewed by a person'} · ProofPass {r.id}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <Button size="sm" onClick={() => setListening(true)} icon={<AudioLines className="size-4" />}>
              Listen
            </Button>
            <Popover label="Reader settings" trigger={(open, toggle) => <IconButton label="Reader settings" onClick={toggle}>{<Settings2 className="size-[18px]" />}</IconButton>}>
              <ReaderControls />
            </Popover>
          </div>
        </div>
        {!r.semantic && (
          <p className="mb-5 flex gap-2 rounded-xl bg-warn-soft px-4 py-3 text-[13px]">
            <FlaskConical className="mt-0.5 size-4 shrink-0 text-warn" />
            {r.statement}
          </p>
        )}
        <article
          className={cx('reader rounded-2xl border border-border bg-surface px-6 py-8 shadow-card sm:px-10', `font-${prefs.readerFont}`, `size-${prefs.readerSize}`, `spacing-${prefs.readerSpacing}`)}
          lang={props.labelsCode}
          dir={props.rtl ? 'rtl' : 'ltr'}
          data-pane="explanation"
        >
          <ExplanationBody model={plain} handlers={{ speaking: voice.state.speaking }} definitions={props.version.definitions} definitionsLabel={props.labels.definitions} />
          {r.official && <p className="mt-8 border-t border-border pt-4 text-[0.82em] text-text-3">{r.official}</p>}
        </article>
        <label className="mt-4 flex items-center gap-2 text-sm text-text-2">
          <input type="checkbox" checked={showEvidence} onChange={(e) => setShowEvidence(e.target.checked)} className="size-4 accent-[var(--accent)]" />
          Show which facts were checked
        </label>
        <p className="mt-6 text-xs text-text-3">
          Explanation for: {r.audience} · {r.language}. Original document: {r.document}. The original is the official source. Made with {props.footer}.
        </p>
      </main>
      {listening && <VoiceDock voice={voice} onClose={() => (voice.stop(), setListening(false))} />}
    </div>
  );
}
