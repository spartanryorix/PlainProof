// Deterministic checks that run after the Verifier. The model gives judgments; these make sure
// each judgment is backed by text that actually exists, and flag what is not.

import { dateKeys, findQuote, numbersIn, splitSentences, type Span } from './text';
import { STATUSES, type Claim, type ClaimResult, type Invention, type Status } from './types';

const LOW_CONFIDENCE = 0.6;
const overlaps = (a: Span, b: Span) => a.start < b.end && b.start < a.end;

export interface RawJudgment {
  id?: string;
  status?: string;
  evidence?: string;
  note?: string;
  confidence?: number;
}

export interface RawInvention {
  quote?: string;
  note?: string;
  severity?: string;
}

export function applyGuards(input: {
  source: string;
  adapted: string;
  claims: Claim[];
  results: RawJudgment[];
  inventions: RawInvention[];
  protectedTerms: string[];
  semantic: boolean;
  // Month names can only be compared when the explanation is written in English.
  englishOutput?: boolean;
}): { results: ClaimResult[]; inventions: Invention[]; missingTerms: string[] } {
  const { source, adapted, claims, protectedTerms } = input;
  const byId = new Map(input.results.filter((r) => r?.id).map((r) => [String(r.id).toLowerCase(), r]));
  const adaptedNumbers = numbersIn(adapted, { words: true });
  const adaptedDates = dateKeys(adapted);

  const results: ClaimResult[] = claims.map((claim) => {
    const r = byId.get(claim.id);
    const flags: string[] = [];
    if (!r) {
      return {
        id: claim.id,
        status: 'missing',
        evidence: '',
        note: 'The verifier returned no judgment for this fact.',
        confidence: 0,
        uncertain: true,
        unjudged: true,
        flags: ['No judgment was returned, so this fact is not verified.'],
      };
    }
    const status: Status = (STATUSES as readonly string[]).includes(String(r.status)) ? (r.status as Status) : 'missing';
    if (status !== r.status) flags.push('The verifier returned an unknown status.');
    const confidence = Math.min(1, Math.max(0, Number(r.confidence) || 0));
    const evidence = status === 'missing' ? '' : String(r.evidence ?? '').trim();

    if (status === 'preserved' || status === 'weakened') {
      // The verifier has to show its receipts: a quote that is not in the text is not trusted.
      if (!evidence || !findQuote(adapted, evidence)) flags.push("The verifier's supporting quote was not found in the adapted text.");
    }
    if (status === 'preserved') {
      const lost = [...numbersIn(claim.values.join(' ; '))].filter((n) => !adaptedNumbers.has(n));
      if (lost.length) flags.push(`The number ${lost.join(', ')} from the original was not found in the adapted text.`);
      if (input.englishOutput) {
        const lostDates = claim.values.filter((v) => [...dateKeys(v)].some((k) => !adaptedDates.has(k)));
        if (lostDates.length) flags.push(`The date ${lostDates.join(', ')} from the original was not found in the adapted text.`);
      }
    }
    if (confidence < LOW_CONFIDENCE) flags.push(`The verifier was not confident (${Math.round(confidence * 100)} in 100).`);

    return {
      id: claim.id,
      status,
      evidence,
      note: String(r.note ?? '').trim(),
      confidence,
      uncertain: flags.length > 0,
      unjudged: false,
      flags,
    };
  });

  // Unsupported statements: keep only those whose quote really is in the adapted text.
  const spans: Span[] = [];
  const inventions: Invention[] = [];
  for (const inv of input.inventions) {
    const quote = String(inv?.quote ?? '').trim();
    const at = quote ? findQuote(adapted, quote) : null;
    if (!at) continue;
    spans.push(at);
    inventions.push({ quote, note: String(inv.note ?? '').trim(), severity: inv.severity === 'high' ? 'high' : 'low', source: 'detector' });
  }
  for (const r of results) {
    if (r.status !== 'distorted' || !r.evidence) continue;
    const at = findQuote(adapted, r.evidence);
    if (at) spans.push(at);
  }

  // Any number the original never mentions is suspicious on its own.
  const sourceNumbers = numbersIn(source, { words: true });
  for (const sentence of splitSentences(adapted)) {
    const novel = [...numbersIn(sentence.text)].filter((n) => !sourceNumbers.has(n));
    if (!novel.length || spans.some((s) => overlaps(s, sentence))) continue;
    spans.push(sentence);
    inventions.push({
      quote: sentence.text.replace(/^[-•]\s*/, ''),
      note: `The number ${novel.join(', ')} does not appear in the original.`,
      severity: 'low',
      source: 'guard',
    });
  }

  const lowerSource = source.toLowerCase();
  const lowerAdapted = adapted.toLowerCase();
  const missingTerms = protectedTerms.filter((t) => lowerSource.includes(t.toLowerCase()) && !lowerAdapted.includes(t.toLowerCase()));

  return { results, inventions, missingTerms };
}
