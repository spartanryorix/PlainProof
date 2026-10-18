// Orchestrates one run: extract claims once per document, then for each audience
// write -> verify -> (repair -> verify)* and issue a ProofPass receipt.

import { randomUUID } from 'node:crypto';
import * as agents from './agents';
import { Meter, type Endpoint } from './llm';
import { applyGuards } from './guards';
import { assess, betterRound } from './scoring';
import { fullText } from './adapted';
import { buildReceipt } from './receipt';
import { findQuote, paragraphAt, splitParagraphs } from './text';
import { PROFILES, type ProfileId } from './profiles';
import {
  CLAIM_TYPES, CRITICALITY, type Adapted, type Claim, type ClaimType, type CostSummary, type Criticality, type Domain,
  type EngineInfo, type Fault, type PipelineEvent, type Receipt, type Round, type RunRequest,
} from './types';

export interface EngineDeps {
  endpoint: Endpoint;
  verifierEndpoint: Endpoint;
  info: EngineInfo;
  gpuHourlyUsd: number;
  maxClaims: number;
  verifyBatch: number;
}

export interface DocumentInput {
  id: string;
  title: string;
  filename: string | null;
  extraction: string;
  text: string;
  claims: Claim[] | null;
  domain: Domain | null;
  sourceLanguage: string | null;
}

export interface VersionRecord {
  versionId: string;
  profile: ProfileId;
  language: RunRequest['language'];
  tone: RunRequest['tone'];
  level: number;
  storyMode: boolean;
  rounds: Round[];
  finalRound: number;
  receipt: Receipt;
  cost: CostSummary;
}

export interface PipelineHooks {
  onClaims?: (claims: Claim[], domain: Domain, title: string, sourceLanguage: string) => void;
  onVersion?: (record: VersionRecord) => void;
}

export function cleanClaims(raw: { text?: string; type?: string; criticality?: string; source_quote?: string; values?: unknown[]; id?: string }[], source: string, maxClaims: number): Claim[] {
  const paragraphs = splitParagraphs(source);
  const claims: Claim[] = [];
  for (const c of raw ?? []) {
    const text = String(c?.text ?? '').trim();
    if (!text) continue;
    const quote = String(c.source_quote ?? '').trim();
    const at = quote ? findQuote(source, quote) : null;
    claims.push({
      id: `c${claims.length + 1}`,
      text,
      type: ((CLAIM_TYPES as readonly string[]).includes(String(c.type)) ? c.type : 'fact') as ClaimType,
      criticality: ((CRITICALITY as readonly string[]).includes(String(c.criticality)) ? c.criticality : 'important') as Criticality,
      source_quote: quote,
      values: Array.isArray(c.values) ? c.values.map(String).filter(Boolean).slice(0, 8) : [],
      located: Boolean(at),
      paragraph: at ? paragraphAt(paragraphs, at.start) : null,
    });
    if (claims.length >= maxClaims) break;
  }
  return claims;
}

// Demo and test aid: corrupt one critical value in the first draft, the way a careless rewrite
// might, so the verifier has a real error to catch. Always recorded on the receipt.
export function injectFault(version: Adapted, claims: Claim[]): { version: Adapted; fault: Fault | null } {
  const order: ClaimType[] = ['money', 'deadline', 'percentage', 'dose', 'warning'];
  const rank = (t: ClaimType) => (order.includes(t) ? order.indexOf(t) : 9);
  const candidates = claims.filter((c) => c.criticality === 'critical').sort((a, b) => rank(a.type) - rank(b.type));
  for (const claim of candidates) {
    for (const value of claim.values) {
      const raw = value.match(/\d+(?:[.,]\d+)?/)?.[0];
      if (!raw) continue;
      const decimals = raw.match(/[.,](\d+)$/)?.[1].length ?? 0;
      const n = Number(raw.replace(',', '.'));
      if (!decimals && n >= 1900 && n <= 2100) continue;
      let changed: string;
      if (decimals) changed = (n * 2).toFixed(decimals).replace('.', raw.includes(',') ? ',' : '.');
      else if (n < 10) changed = String(n + 1);
      else if (n <= 31 && (claim.type === 'deadline' || claim.type === 'date')) changed = String(n <= 21 ? n + 7 : n - 7);
      else changed = String(n * 2);
      const unit = value.slice(value.indexOf(raw) + raw.length).trim().split(/\s+/)[0] || '';
      const bare = `(?<![\\d.,])${raw.replace(/[.,]/, '[.,]')}(?![\\d]|[.,]\\d)`;
      const swap = (re: RegExp) => (s: string) => s.replace(re, changed);
      const res = [unit && new RegExp(`${bare}(?=\\s?${unit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'g'), new RegExp(bare, 'g')].filter(Boolean) as RegExp[];
      const re = res.find((r) => r.test(fullText(version)));
      if (!re) continue;
      const fix = swap(re);
      const items = (xs: Adapted['actions']) => xs.map((i) => ({ ...i, text: fix(i.text) }));
      return {
        version: {
          ...version,
          overview: fix(version.overview),
          explanation: fix(version.explanation),
          actions: items(version.actions),
          warnings: items(version.warnings),
          keyFacts: items(version.keyFacts),
          changes: items(version.changes),
        },
        fault: { claimId: claim.id, from: raw, to: changed, description: `"${raw}" was changed to "${changed}" in the first draft (fact: ${claim.text.replace(/[.!?]+$/, '')})` },
      };
    }
  }
  return { version, fault: null };
}

interface VersionContext {
  doc: DocumentInput & { claims: Claim[]; domain: Domain; sourceLanguage: string };
  reader: agents.ReaderContext;
  deps: EngineDeps;
  meter: Meter;
  signal?: AbortSignal;
}

async function verifyVersion(ctx: VersionContext, version: Adapted) {
  const adapted = fullText(version);
  const agentDeps = { endpoint: ctx.deps.endpoint, verifierEndpoint: ctx.deps.verifierEndpoint, meter: ctx.meter, signal: ctx.signal };
  const claims = ctx.doc.claims;
  const batches: Claim[][] = [];
  for (let i = 0; i < claims.length; i += ctx.deps.verifyBatch) batches.push(claims.slice(i, i + ctx.deps.verifyBatch));
  // Claim batches and the invention check run in parallel; vLLM batches them on the GPU.
  const [judged, inventions] = await Promise.all([
    Promise.all(batches.map((b) => agents.verify(b, adapted, agentDeps))),
    agents.detectInventions(ctx.doc.text, adapted, ctx.reader.storyMode, agentDeps),
  ]);
  const guarded = applyGuards({
    source: ctx.doc.text,
    adapted,
    claims,
    results: judged.flat(),
    inventions,
    protectedTerms: ctx.reader.protectedTerms,
    semantic: ctx.deps.info.semantic,
    englishOutput: ctx.reader.language === 'en' || (ctx.reader.language === 'source' && /english/i.test(ctx.doc.sourceLanguage)),
  });
  return { ...guarded, assessment: assess(claims, guarded.results, guarded.inventions, guarded.missingTerms) };
}

function problemsFor(claims: Claim[], check: Awaited<ReturnType<typeof verifyVersion>>): agents.Problem[] {
  const byId = new Map(claims.map((c) => [c.id, c]));
  const problems: agents.Problem[] = [];
  for (const r of check.results) {
    if (r.status === 'preserved' && !r.unjudged) continue;
    const c = byId.get(r.id)!;
    problems.push({
      kind: r.status === 'preserved' ? 'missing' : r.status,
      claim_id: c.id,
      claim: c.text,
      source_passage: c.source_quote,
      values: c.values,
      adapted_says: r.evidence,
      verifier_note: r.note,
    });
  }
  for (const inv of check.inventions) problems.push({ kind: 'invention', quote: inv.quote, verifier_note: inv.note });
  for (const term of check.missingTerms) problems.push({ kind: 'protected_term', term });
  return problems;
}

function readerContext(doc: VersionContext['doc'], req: RunRequest, profileId: ProfileId, level: number | null | undefined): agents.ReaderContext {
  const profile = PROFILES[profileId];
  return {
    profile,
    grade: level ?? profile.grade,
    tone: req.tone,
    language: req.language,
    sourceLanguage: doc.sourceLanguage,
    storyMode: req.storyMode && profileId === 'child',
    protectedTerms: req.protectedTerms,
  };
}

async function runVersion(
  doc: VersionContext['doc'],
  req: RunRequest,
  spec: RunRequest['profiles'][number],
  index: number,
  deps: EngineDeps,
  root: Meter,
  emit: (e: PipelineEvent) => void,
  hooks: PipelineHooks,
  signal?: AbortSignal,
) {
  const meter = root.child();
  const reader = readerContext(doc, req, spec.id, spec.level);
  const ctx: VersionContext = { doc, reader, deps, meter, signal };
  const agentDeps = { endpoint: deps.endpoint, verifierEndpoint: deps.verifierEndpoint, meter, signal };
  const profile = spec.id;
  const cost = () => emit({ type: 'cost', cost: root.summary() });
  const rounds: Round[] = [];

  emit({ type: 'phase', profile, phase: 'writing', round: 0 });
  let version = await agents.write(doc.text, doc.claims, reader, agentDeps, (delta) => emit({ type: 'delta', profile, round: 0, delta }));
  let fault: Fault | null = null;
  if (req.injectFault && index === 0) ({ version, fault } = injectFault(version, doc.claims));
  cost();

  for (let round = 0; ; round++) {
    const kind: Round['kind'] = round === 0 ? 'draft' : 'repair';
    emit({ type: 'draft', profile, round, kind, version, fault: round === 0 ? fault : null });
    emit({ type: 'phase', profile, phase: 'verifying', round });
    const check = await verifyVersion(ctx, version);
    rounds.push({ round, kind, version, fault: round === 0 ? fault : null, ...check });
    emit({ type: 'verified', profile, round, results: check.results, inventions: check.inventions, missingTerms: check.missingTerms, assessment: check.assessment });
    cost();

    const problems = problemsFor(doc.claims, check);
    if (check.assessment.outcome === 'clear' || !problems.length || round >= req.maxRepairs) break;
    emit({ type: 'phase', profile, phase: 'repairing', round: round + 1, targets: problems.flatMap((p) => (p.claim_id ? [p.claim_id] : [])), problems: problems.length });
    version = await agents.repair(doc.text, doc.claims, reader, version, problems, agentDeps, (delta) => emit({ type: 'delta', profile, round: round + 1, delta }));
    cost();
  }

  // Never ship a regression: the receipt is issued for the best round, not simply the last one.
  const best = rounds.reduce((a, b) => betterRound(b, a));
  const versionId = randomUUID();
  const summary = meter.summary();
  const receipt = buildReceipt({
    documentId: doc.id,
    documentTitle: doc.title,
    filename: doc.filename,
    extraction: doc.extraction,
    source: doc.text,
    sourceLanguage: doc.sourceLanguage,
    domain: doc.domain,
    claims: doc.claims,
    profile,
    language: req.language,
    tone: req.tone,
    targetGrade: reader.grade,
    storyMode: reader.storyMode,
    rounds,
    best,
    fault,
    engine: deps.info,
    cost: summary,
    protectedTerms: req.protectedTerms,
    versionId,
  });
  hooks.onVersion?.({ versionId, profile, language: req.language, tone: req.tone, level: reader.grade, storyMode: reader.storyMode, rounds, finalRound: best.round, receipt, cost: summary });
  emit({ type: 'final', profile, versionId, round: best.round, receipt, cost: summary });
}

export async function runPipeline(
  input: DocumentInput,
  req: RunRequest,
  deps: EngineDeps,
  emit: (e: PipelineEvent) => void = () => {},
  hooks: PipelineHooks = {},
  signal?: AbortSignal,
) {
  const meter = new Meter(deps.gpuHourlyUsd, deps.info.mode === 'preview');
  let { claims, domain, title, sourceLanguage } = input;
  if (!claims?.length) {
    emit({ type: 'stage', stage: 'extract', status: 'active' });
    const extracted = await agents.extract(input.text, deps.maxClaims, { endpoint: deps.endpoint, verifierEndpoint: deps.verifierEndpoint, meter, signal });
    const found = cleanClaims(extracted.claims, input.text, deps.maxClaims);
    if (!found.length) throw new Error('No checkable facts were found in this document.');
    const lang = extracted.language || 'Unknown';
    claims = found;
    domain = extracted.domain;
    title = extracted.title || input.title;
    sourceLanguage = lang;
    hooks.onClaims?.(found, extracted.domain, title, lang);
    emit({ type: 'cost', cost: meter.summary() });
  }
  emit({ type: 'stage', stage: 'extract', status: 'done' });
  emit({ type: 'claims', claims, domain: domain ?? 'general', title });

  const doc = { ...input, claims, domain: domain ?? 'general', title, sourceLanguage: sourceLanguage ?? 'Unknown' };
  await Promise.all(
    req.profiles.map((spec, i) =>
      runVersion(doc, req, spec, i, deps, meter, emit, hooks, signal).catch((err) => {
        if (signal?.aborted) throw err;
        emit({ type: 'version-error', profile: spec.id, message: (err as Error).message });
      }),
    ),
  );
  const cost = meter.summary();
  emit({ type: 'done', cost });
  return { claims, domain: doc.domain, title, cost };
}

// Re-verify a version a human reviewer edited. Same verifier, same guards.
export async function reverify(doc: VersionContext['doc'], req: RunRequest, version: Adapted, deps: EngineDeps) {
  const meter = new Meter(deps.gpuHourlyUsd, deps.info.mode === 'preview');
  const spec = req.profiles[0];
  const ctx: VersionContext = { doc, reader: readerContext(doc, req, spec.id, spec.level), deps, meter };
  const check = await verifyVersion(ctx, version);
  return { check, cost: meter.summary() };
}
