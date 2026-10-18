// ProofPass: the Fidelity Receipt. It records what was actually done, including what was not.

import { createHash } from 'node:crypto';
import { fullText } from './adapted';
import { findingOf, FINDING_LABEL, flaggedItems, reviewStatus } from './scoring';
import { readability } from './text';
import { labelsFor, languageOf, outputLabelCode, PROFILES, SENSITIVE_DOMAINS, type LanguageCode, type ProfileId, type ToneId } from './profiles';
import type { Claim, CostSummary, Domain, EngineInfo, Fault, Receipt, ReviewDecision, Round } from './types';

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export interface ReceiptInput {
  documentId: string;
  documentTitle: string;
  filename: string | null;
  extraction: string;
  source: string;
  sourceLanguage: string;
  domain: Domain;
  claims: Claim[];
  profile: ProfileId;
  language: LanguageCode;
  tone: ToneId;
  targetGrade: number;
  storyMode: boolean;
  rounds: Round[];
  best: Round;
  fault: Fault | null;
  engine: EngineInfo;
  cost: CostSummary;
  protectedTerms: string[];
  versionId: string;
}

export function buildReceipt(input: ReceiptInput): Receipt {
  const { best, claims, engine } = input;
  const adapted = fullText(best.version);
  const stats = readability(adapted);
  const byId = new Map(best.results.map((r) => [r.id, r]));
  const claimRows = claims.map((c) => {
    const result = byId.get(c.id)!;
    return { ...c, finding: findingOf(result), result };
  });
  const unresolved = [
    ...claimRows.filter((c) => c.finding !== 'matched').map((c) => ({ item: c.id, label: c.text, finding: FINDING_LABEL[c.finding] })),
    ...best.inventions.map((inv, i) => ({ item: `inv${i}`, label: inv.quote, finding: 'Unsupported statement' })),
    ...best.missingTerms.map((t) => ({ item: `term:${t}`, label: t, finding: 'Protected term changed' })),
  ];
  const lang = languageOf(input.language);
  const languageLabel = input.language === 'source' ? 'Original language' : lang.name;
  const english = input.language === 'en' || (input.language === 'source' && /english/i.test(input.sourceLanguage));

  return {
    schema: 'plainproof.proofpass/2',
    receiptId: `PP-${sha256(input.versionId + adapted).slice(0, 10).toUpperCase()}`,
    issuedAt: new Date().toISOString(),
    document: {
      id: input.documentId,
      title: input.documentTitle,
      filename: input.filename,
      sha256: sha256(input.source),
      words: readability(input.source).words,
      domain: input.domain,
      extraction: input.extraction,
    },
    audience: {
      profile: input.profile,
      label: PROFILES[input.profile].label,
      language: input.language,
      languageLabel,
      tone: input.tone,
      targetGrade: input.targetGrade,
      storyMode: input.storyMode,
    },
    adapted: { sha256: sha256(adapted), words: stats.words, grade: english ? stats.grade : null },
    engine,
    verification: {
      semantic: engine.semantic,
      statement: engine.semantic
        ? `Each fact was checked by an independent verifier agent (${engine.verifierModel}). Its quotes and every number were then matched mechanically against the text. This is an automated assessment and can contain errors.`
        : 'Semantic verification not performed. Preview Mode compared the texts with rule-based lexical and numeric checks only; no AI model was connected.',
      outcome: best.assessment.outcome,
      reasons: best.assessment.reasons,
      claimCount: claims.length,
      criticalCount: best.assessment.counts.critical,
      counts: best.assessment.counts,
    },
    claims: claimRows,
    inventions: best.inventions,
    protectedTerms: { required: input.protectedTerms, missing: best.missingTerms },
    rounds: input.rounds.map((r) => ({
      round: r.round,
      kind: r.kind,
      outcome: r.assessment.outcome,
      problems: flaggedItems(r.results, r.inventions).length + r.missingTerms.length,
    })),
    repairAttempts: input.rounds.filter((r) => r.kind === 'repair').length,
    selectedRound: best.round,
    unresolved,
    faultInjection: input.fault,
    cost: input.cost,
    humanReview: { status: 'not-reviewed', decisions: [], flaggedItems: flaggedItems(best.results, best.inventions).length },
    limitations: limitations(input, unresolved.length),
    officialSourceNote: SENSITIVE_DOMAINS.includes(input.domain) ? labelsFor(outputLabelCode(input.language, input.sourceLanguage)).official : null,
  };
}

function limitations(input: ReceiptInput, unresolved: number): string[] {
  const out = [
    'This receipt records an automated assessment. It is not a guarantee that the explanation is complete or correct.',
    'The original document remains the official source.',
  ];
  if (!input.engine.semantic) out.push('Semantic verification not performed: Preview Mode used rule-based rewording and lexical checks, without an AI model.');
  if (input.language === 'ar' || input.language === 'ta') {
    out.push('The explanation was translated by the model. Numbers, dates and protected terms were matched mechanically; meaning was judged by the verifier model across languages.');
  }
  if (/ocr/i.test(input.extraction)) out.push('The text was read with OCR and may contain recognition errors. Compare the original page.');
  if (unresolved) out.push(`${unresolved} finding${unresolved === 1 ? ' was' : 's were'} not resolved automatically and need${unresolved === 1 ? 's' : ''} human review.`);
  if (input.fault) out.push('A test fault was deliberately injected into the first draft to demonstrate the verifier.');
  return out;
}

// Merge the reviewer's decisions (stored separately, they change after issue) into the receipt.
export function withReview(receipt: Receipt, decisions: ReviewDecision[]): Receipt {
  const results = receipt.claims.map((c) => c.result);
  const { status, flagged } = reviewStatus(results, receipt.inventions, decisions);
  return { ...receipt, humanReview: { status, decisions, flaggedItems: flagged } };
}
