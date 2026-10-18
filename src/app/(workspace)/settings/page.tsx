'use client';

import { useEffect, useState } from 'react';
import { Cpu, FlaskConical, Trash2 } from 'lucide-react';
import { api } from '@/lib/client/api';
import { Button, Card, Dialog, Segmented } from '@/components/ui';
import { useHealth, usePrefs, useToast } from '@/components/providers';
import { ReaderControls } from '@/components/studio/panels';

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card className="p-5 sm:p-6">
      <h2 className="font-display text-[16px] font-semibold">{title}</h2>
      {description && <p className="mt-0.5 text-sm text-text-2">{description}</p>}
      <div className="mt-5">{children}</div>
    </Card>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-3 text-sm last:border-0">
      <span className="text-text-2">{label}</span>
      <div>{children}</div>
    </div>
  );
}

export default function SettingsPage() {
  const { prefs, setPrefs } = usePrefs();
  const health = useHealth();
  const toast = useToast();
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const update = () => setVoices(window.speechSynthesis.getVoices());
    update();
    window.speechSynthesis.addEventListener('voiceschanged', update);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', update);
  }, []);

  const deleteAll = async () => {
    try {
      const r = await api<{ deleted: number }>('/api/documents', { method: 'DELETE', headers: { 'x-confirm': 'delete-all' } });
      toast(`Deleted ${r.deleted} document${r.deleted === 1 ? '' : 's'}.`, 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
    setConfirm(false);
  };

  const neural = health?.tts.available;

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-5 py-8 sm:px-8 sm:py-12">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-text-2">Preferences are stored in this browser only.</p>
      </div>

      <Section title="Appearance">
        <Row label="Theme">
          <Segmented label="Theme" value={prefs.theme} onChange={(theme) => setPrefs({ theme })} options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
        </Row>
        <Row label="Motion">
          <Segmented label="Motion" value={prefs.motion} onChange={(motion) => setPrefs({ motion })} options={[{ value: 'system', label: 'System' }, { value: 'reduce', label: 'Reduced' }, { value: 'full', label: 'Full' }]} />
        </Row>
      </Section>

      <Section title="Reading" description="How explanations are displayed. Profiles may suggest their own defaults.">
        <div className="max-w-md">
          <ReaderControls />
        </div>
      </Section>

      <Section title="Voice" description={neural ? `A neural voice service is connected (${health?.tts.label}).` : 'No neural voice service is connected, so the voices built into this browser are used.'}>
        <Row label="Default speed">
          <select value={prefs.voiceRate} onChange={(e) => setPrefs({ voiceRate: Number(e.target.value) })} className="h-9 rounded-lg border border-border bg-surface px-2 text-sm">
            {[0.75, 0.9, 1, 1.15, 1.3, 1.5].map((r) => (
              <option key={r} value={r}>
                {r}×
              </option>
            ))}
          </select>
        </Row>
        <Row label="Preferred voice">
          <select value={prefs.voiceName} onChange={(e) => setPrefs({ voiceName: e.target.value })} className="h-9 max-w-64 rounded-lg border border-border bg-surface px-2 text-sm">
            <option value="">Automatic for the language</option>
            {(neural ? (health?.tts.voices ?? []) : voices.map((v) => `${v.name}`)).map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </Row>
        <p className="mt-2 text-xs text-text-3">
          Browser voices installed here: {voices.length ? [...new Set(voices.map((v) => v.lang.slice(0, 2)))].join(', ') : 'none detected'}. Arabic or Tamil narration needs a voice for that language.
        </p>
      </Section>

      <Section title="Review" description="Your name is added to review decisions on the ProofPass receipt.">
        <Row label="Reviewer name">
          <input value={prefs.reviewer} onChange={(e) => setPrefs({ reviewer: e.target.value.slice(0, 80) })} placeholder="Optional" className="h-9 w-56 rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:border-accent" />
        </Row>
      </Section>

      <Section title="Privacy and data">
        <ul className="space-y-2 text-sm text-text-2">
          <li>Uploaded files are read in memory and not kept. Only the extracted text is stored.</li>
          <li>Documents, explanations and receipts are deleted automatically after {health?.retentionHours ?? 72} hours.</li>
          <li>Document text is sent only to the configured AI endpoint. It is never written to the server logs.</li>
          <li>PlainProof has not been assessed for HIPAA, GDPR or any other certification.</li>
        </ul>
        <div className="mt-5">
          <Button variant="secondary" onClick={() => setConfirm(true)} icon={<Trash2 className="size-4" />}>
            Delete all documents now
          </Button>
        </div>
      </Section>

      <Section title="AI configuration" description="Read only. Set on the server through environment variables.">
        {!health ? (
          <p className="text-sm text-text-3">Loading…</p>
        ) : (
          <>
            <div className={`mb-4 flex items-start gap-3 rounded-xl px-4 py-3 text-sm ${health.mode === 'preview' ? 'bg-warn-soft' : 'bg-ok-soft'}`}>
              {health.mode === 'preview' ? <FlaskConical className="mt-0.5 size-4 shrink-0 text-warn" /> : <Cpu className="mt-0.5 size-4 shrink-0 text-ok" />}
              <span>
                {health.mode === 'preview'
                  ? 'Preview Mode. No AI model is connected: explanations use rule-based rewording, checks are lexical, Arabic and Tamil are unavailable, and receipts say "Semantic verification not performed". Set LLM_BASE_URL to the vLLM endpoint on AMD to enable AI inference.'
                  : 'AI inference is connected. Extraction, writing, verification and repair run on the model below.'}
              </span>
            </div>
            <Row label="Writer model">{health.writerModel}</Row>
            <Row label="Verifier model">{health.verifierModel}</Row>
            <Row label="Endpoint">{health.endpoint || '–'}</Row>
            <Row label="Hardware">{health.hardware}</Row>
            <Row label="Photo reading (OCR)">{health.vision ? 'AI vision model' : `Tesseract (${health.ocr.langs})`}</Row>
            <Row label="Neural voice">{health.tts.available ? `${health.tts.label} (${health.tts.languages?.join(', ')})` : 'Not configured'}</Row>
            <Row label="Upload limit">{`${health.limits.maxUploadMb} MB, ${health.limits.maxChars.toLocaleString()} characters`}</Row>
          </>
        )}
      </Section>

      <Dialog open={confirm} onOpenChange={setConfirm} title="Delete all documents?" description="Every document, explanation, review decision and receipt on this server will be deleted. This cannot be undone.">
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirm(false)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={deleteAll}>
            Delete everything
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
