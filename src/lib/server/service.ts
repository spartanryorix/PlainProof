// Application services used by the route handlers (and directly by the tests).

import { z } from 'zod';
import { config, engineDeps } from './config';
import * as store from './db';
import { extractDocument, IntakeError, normalizeText, safeFilename, validateText } from './parse';
import { HttpError } from './http';
import { runPipeline, reverify } from '@/lib/engine/pipeline';
import { buildReceipt, withReview } from '@/lib/engine/receipt';
import { parseAdapted } from '@/lib/engine/adapted';
import { readability } from '@/lib/engine/text';
import { PROFILE_ORDER, type ProfileId } from '@/lib/engine/profiles';
import { sampleById } from '@/lib/samples';
import type { EngineInfo, PipelineEvent, ReviewDecision, Round, RunRequest } from '@/lib/engine/types';

export type StreamEvent = PipelineEvent | { type: 'run'; documentId: string; engine: EngineInfo };

const titleFrom = (text: string, fallback: string) => {
  const first = text.split('\n').map((l) => l.trim()).find((l) => l.length > 3) ?? fallback;
  return first.length > 90 ? `${first.slice(0, 87)}…` : first;
};

export async function createFromUpload(file: File) {
  const filename = safeFilename(file.name);
  if (file.size > config.limits.maxUploadBytes) {
    throw new IntakeError(`The file is larger than ${Math.round(config.limits.maxUploadBytes / 1024 / 1024)} MB.`, 413);
  }
  const buf = Buffer.from(await file.arrayBuffer());
  const ex = await extractDocument(buf, filename);
  const doc = store.createDocument({
    title: titleFrom(ex.text, filename),
    filename,
    mime: ex.kind,
    sizeBytes: buf.length,
    source: 'upload',
    extraction: ex.method,
    pages: ex.pages,
    text: ex.text,
    words: readability(ex.text).words,
  });
  return { document: doc, warnings: ex.warnings };
}

export function createFromText(raw: string, title?: string) {
  const text = normalizeText(raw);
  validateText(text);
  const doc = store.createDocument({
    title: title?.trim().slice(0, 120) || titleFrom(text, 'Pasted text'),
    filename: null,
    mime: 'text',
    sizeBytes: Buffer.byteLength(text),
    source: 'paste',
    extraction: 'Pasted text',
    pages: null,
    text,
    words: readability(text).words,
  });
  return { document: doc, warnings: [] as string[] };
}

export function createFromSample(id: string) {
  const sample = sampleById(id);
  if (!sample) throw new HttpError('Unknown sample.', 404);
  const doc = store.createDocument({
    title: sample.label,
    filename: sample.filename,
    mime: 'text',
    sizeBytes: Buffer.byteLength(sample.text),
    source: 'sample',
    extraction: 'Sample document (text)',
    pages: null,
    text: sample.text,
    words: readability(sample.text).words,
  });
  return { document: doc, warnings: [] as string[], suggested: { tone: sample.tone, protectedTerms: sample.protectedTerms } };
}

export function getDocumentOr404(id: string) {
  const doc = store.getDocument(id);
  if (!doc) throw new HttpError('This document does not exist or has been deleted.', 404);
  return doc;
}

export function getVersionOr404(id: string) {
  const v = store.getVersion(id);
  if (!v) throw new HttpError('This version does not exist or has been deleted.', 404);
  return v;
}

export const RunSchema = z.object({
  profiles: z
    .array(z.object({ id: z.enum(PROFILE_ORDER as [ProfileId, ...ProfileId[]]), level: z.number().int().min(1).max(12).nullish() }))
    .min(1)
    .max(6),
  language: z.enum(['source', 'en', 'ar', 'ta']).default('en'),
  tone: z.enum(['neutral', 'reassuring', 'urgent']).default('neutral'),
  storyMode: z.boolean().default(false),
  protectedTerms: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  maxRepairs: z.number().int().min(0).max(3).default(2),
  injectFault: z.boolean().default(false),
});

export function checkRunAllowed(req: RunRequest) {
  if (config.preview && (req.language === 'ar' || req.language === 'ta')) {
    throw new HttpError('Arabic and Tamil need the AI model. Preview Mode cannot translate, so it will not label English text as Arabic or Tamil.', 400);
  }
  const ids = req.profiles.map((p) => p.id);
  if (new Set(ids).size !== ids.length) throw new HttpError('Each audience can only be generated once per run.', 400);
}

// Run the pipeline for a stored document and stream every step as a server-sent event.
export function runStream(documentId: string, req: RunRequest, signal: AbortSignal): ReadableStream<Uint8Array> {
  const doc = getDocumentOr404(documentId);
  checkRunAllowed(req);
  const enc = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (ev: StreamEvent) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(ev)}\n\n`));
        } catch {
          closed = true;
        }
      };
      const keepAlive = setInterval(() => {
        if (!closed) controller.enqueue(enc.encode(': keep-alive\n\n'));
      }, 15_000);
      try {
        const deps = await engineDeps();
        send({ type: 'run', documentId, engine: deps.info });
        await runPipeline(
          {
            id: doc.id,
            title: doc.title,
            filename: doc.filename,
            extraction: doc.extraction,
            text: doc.text,
            claims: doc.claims,
            domain: doc.domain,
            sourceLanguage: doc.sourceLanguage,
          },
          req,
          deps,
          send,
          {
            onClaims: (claims, domain, title, lang) => store.saveClaims(doc.id, claims, domain, title, lang),
            onVersion: (record) => store.saveVersion(doc.id, record),
          },
          signal,
        );
      } catch (err) {
        if (!signal.aborted) send({ type: 'error', message: (err as Error).message });
      } finally {
        clearInterval(keepAlive);
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });
}

export const ReviewSchema = z.object({
  review: z
    .array(
      z.object({
        item: z.string().max(40),
        label: z.string().max(400),
        note: z.string().max(1000).optional(),
        reviewer: z.string().max(80).optional(),
        at: z.string().max(40),
      }),
    )
    .max(200)
    .optional(),
  actionsDone: z.array(z.string().max(20)).max(200).optional(),
});

export function updateReview(versionId: string, patch: z.infer<typeof ReviewSchema>) {
  getVersionOr404(versionId);
  store.updateVersion(versionId, { review: patch.review as ReviewDecision[] | undefined, actionsDone: patch.actionsDone });
  return store.getVersion(versionId)!;
}

export function finalReceipt(versionId: string) {
  const v = getVersionOr404(versionId);
  return { version: v, receipt: withReview(v.receipt, v.review) };
}

// A reviewer edited the explanation: verify the edit like any other draft and issue a new receipt.
export async function verifyEdit(versionId: string, adaptedText: string) {
  const v = getVersionOr404(versionId);
  const doc = getDocumentOr404(v.documentId);
  if (!doc.claims?.length) throw new HttpError('This document has no extracted facts yet.', 409);
  const version = parseAdapted(adaptedText);
  if (!version.explanation && !version.overview) throw new HttpError('The edited text is empty. Keep the section markers (OVERVIEW:, EXPLANATION: and so on).', 400);
  const deps = await engineDeps();
  const req: RunRequest = {
    profiles: [{ id: v.profile, level: v.level }],
    language: v.language,
    tone: v.tone,
    storyMode: v.storyMode,
    protectedTerms: v.receipt.protectedTerms?.required ?? [],
    maxRepairs: 0,
    injectFault: false,
  };
  const docInput = {
    id: doc.id,
    title: doc.docTitle || doc.title,
    filename: doc.filename,
    extraction: doc.extraction,
    text: doc.text,
    claims: doc.claims,
    domain: doc.domain ?? 'general',
    sourceLanguage: doc.sourceLanguage ?? 'Unknown',
  };
  const { check, cost } = await reverify(docInput, req, version, deps);
  const round: Round = { round: v.rounds.length, kind: 'human-edit', version, fault: null, ...check };
  const rounds = [...v.rounds, round];
  const receipt = buildReceipt({
    documentId: doc.id,
    documentTitle: docInput.title,
    filename: doc.filename,
    extraction: doc.extraction,
    source: doc.text,
    sourceLanguage: docInput.sourceLanguage,
    domain: docInput.domain,
    claims: doc.claims,
    profile: v.profile,
    language: v.language,
    tone: v.tone,
    targetGrade: v.level,
    storyMode: v.storyMode,
    rounds,
    best: round,
    fault: v.receipt.faultInjection,
    engine: deps.info,
    cost: { ...cost, calls: v.cost.calls + cost.calls, totalTokens: v.cost.totalTokens + cost.totalTokens, promptTokens: v.cost.promptTokens + cost.promptTokens, completionTokens: v.cost.completionTokens + cost.completionTokens, gpuSeconds: v.cost.gpuSeconds + cost.gpuSeconds, usd: v.cost.usd + cost.usd },
    protectedTerms: req.protectedTerms,
    versionId: v.id,
  });
  store.updateVersion(v.id, { rounds, finalRound: round.round, receipt, review: [] });
  return store.getVersion(v.id)!;
}

// One stateless call for embedding: text in, verified explanations out.
export async function adaptOnce(text: string, req: RunRequest) {
  const normalized = normalizeText(text);
  validateText(normalized);
  checkRunAllowed(req);
  const deps = await engineDeps();
  const versions: { profile: ProfileId; title: string; adapted: unknown; outcome: string; receipt: unknown }[] = [];
  const result = await runPipeline(
    { id: 'api', title: titleFrom(normalized, 'Document'), filename: null, extraction: 'API text', text: normalized, claims: null, domain: null, sourceLanguage: null },
    req,
    deps,
    () => {},
    {
      onVersion: (r) => {
        const round = r.rounds[r.finalRound];
        versions.push({ profile: r.profile, title: round.version.title, adapted: round.version, outcome: r.receipt.verification.outcome, receipt: r.receipt });
      },
    },
  );
  return { claims: result.claims, domain: result.domain, versions, cost: result.cost };
}

