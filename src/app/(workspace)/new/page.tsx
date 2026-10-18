'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, ArrowRight, Wand2 } from 'lucide-react';
import { api, type DocumentRow, type UploadResult } from '@/lib/client/api';
import { AudiencePicker, DEFAULT_RUN, DocumentSummary, Steps, Uploader, type RunSettings } from '@/components/intake';
import { Button, Card, Skeleton } from '@/components/ui';
import { useToast } from '@/components/providers';
import { sampleById } from '@/lib/samples';

function NewDocument() {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const [result, setResult] = useState<UploadResult | null>(null);
  const [step, setStep] = useState<0 | 1>(0);
  const [settings, setSettings] = useState<RunSettings>(DEFAULT_RUN);
  const [loading, setLoading] = useState(Boolean(params.get('doc')));

  const accept = (r: UploadResult) => {
    setResult(r);
    const sample = r.document.source === 'sample' ? sampleByTitle(r.document) : undefined;
    if (r.suggested || sample) {
      setSettings((s) => ({ ...s, tone: r.suggested?.tone ?? sample?.tone ?? s.tone, protectedTerms: r.suggested?.protectedTerms ?? sample?.protectedTerms ?? s.protectedTerms }));
    }
  };

  useEffect(() => {
    const id = params.get('doc');
    if (!id) return;
    api<{ document: DocumentRow }>(`/api/documents/${id}`)
      .then((r) => {
        accept({ document: r.document, warnings: [] });
        setStep(params.get('step') === 'personalize' ? 1 : 0);
      })
      .catch((e) => toast((e as Error).message, 'error'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const generate = () => {
    if (!result) return;
    if (!settings.profiles.length) return toast('Choose at least one audience.', 'error');
    try {
      sessionStorage.setItem(`pp.run.${result.document.id}`, JSON.stringify(settings));
    } catch {
      /* storage blocked: the studio falls back to defaults */
    }
    router.push(`/d/${result.document.id}?run=1`);
  };

  return (
    <div className="mx-auto max-w-4xl px-5 py-8 sm:px-8 sm:py-12">
      <Steps current={step} />
      <div className="mt-8">
        {step === 0 ? (
          <>
            <h1 className="font-display text-3xl font-bold tracking-tight sm:text-[34px]">Add a document</h1>
            <p className="mt-2 max-w-xl text-text-2">Upload a letter, policy, notice or leaflet. PlainProof reads the text, then you choose who the explanation is for.</p>
            <div className="mt-8">
              {loading ? (
                <Skeleton className="h-64 w-full rounded-2xl" />
              ) : result ? (
                <div className="space-y-6">
                  <DocumentSummary result={result} onReplace={() => setResult(null)} />
                  <div className="flex justify-end">
                    <Button variant="primary" size="lg" onClick={() => setStep(1)} icon={<ArrowRight className="size-4" />}>
                      Continue
                    </Button>
                  </div>
                </div>
              ) : (
                <Uploader onCreated={accept} />
              )}
            </div>
          </>
        ) : (
          <>
            <h1 className="font-display text-3xl font-bold tracking-tight sm:text-[34px]">Personalize</h1>
            <p className="mt-2 max-w-xl text-text-2">
              {result?.document.filename ?? result?.document.title}: choose the audiences and the language. Every version is checked fact by fact against the original.
            </p>
            <Card className="mt-8 p-5 sm:p-7">
              <AudiencePicker value={settings} onChange={setSettings} />
            </Card>
            <div className="mt-6 flex items-center justify-between">
              <Button variant="ghost" onClick={() => setStep(0)} icon={<ArrowLeft className="size-4" />}>
                Back
              </Button>
              <Button variant="primary" size="lg" onClick={generate} disabled={!settings.profiles.length} icon={<Wand2 className="size-4" />}>
                Generate {settings.profiles.length > 1 ? `${settings.profiles.length} explanations` : 'explanation'}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function sampleByTitle(doc: DocumentRow) {
  const id = { 'northwind-policy-update.txt': 'insurance', 'portovale-tax-notice.txt': 'tax', 'lumetrol-leaflet.txt': 'leaflet', 'riverbend-school-trip.txt': 'school' }[doc.filename ?? ''];
  return id ? sampleById(id) : undefined;
}

export default function NewPage() {
  return (
    <Suspense fallback={null}>
      <NewDocument />
    </Suspense>
  );
}
