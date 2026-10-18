// Assessment of one adapted version. Deterministic: the models judge each claim, plain code
// turns those judgments into counts and an outcome. No accuracy percentage is produced.

import type { Assessment, Claim, ClaimResult, Finding, Invention, Outcome, ReviewDecision } from './types';

export const WEIGHTS = { critical: 5, important: 2, background: 1 } as const;
const CREDIT = { preserved: 1, weakened: 0.5, distorted: 0, missing: 0 } as const;

export function findingOf(r: ClaimResult | undefined): Finding {
  if (!r || r.unjudged) return 'unverified';
  if (r.status === 'distorted') return 'mismatch';
  if (r.status === 'missing') return 'missing';
  if (r.status === 'weakened' || r.uncertain) return 'review';
  return 'matched';
}

export const FINDING_LABEL: Record<Finding, string> = {
  matched: 'Matched',
  review: 'Needs review',
  mismatch: 'Potential mismatch',
  missing: 'Missing',
  unverified: 'Not verified',
};

export const OUTCOME_LABEL: Record<Outcome, string> = {
  clear: 'No issues found',
  review: 'Needs review',
  issues: 'Issues found',
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function assess(claims: Claim[], results: ClaimResult[], inventions: Invention[] = [], missingTerms: string[] = []): Assessment {
  const byId = new Map(results.map((r) => [r.id, r]));
  const counts = { matched: 0, review: 0, mismatch: 0, missing: 0, unverified: 0, total: claims.length, critical: 0, criticalMatched: 0 };
  const criticalProblems: string[] = [];
  let total = 0;
  let earned = 0;

  for (const c of claims) {
    const r = byId.get(c.id);
    const f = findingOf(r);
    counts[f]++;
    const w = WEIGHTS[c.criticality];
    total += w;
    earned += w * (r && !r.unjudged ? CREDIT[r.status] : 0);
    if (c.criticality === 'critical') {
      counts.critical++;
      if (f === 'matched') counts.criticalMatched++;
      if (f === 'mismatch' || f === 'missing' || f === 'unverified') criticalProblems.push(c.id);
    }
  }

  const inv = { high: 0, low: 0 };
  for (const i of inventions) inv[i.severity]++;

  const reasons: string[] = [];
  if (criticalProblems.length) reasons.push(`${plural(criticalProblems.length, 'critical fact')} not confirmed`);
  if (counts.mismatch) reasons.push(`${plural(counts.mismatch, 'potential mismatch')}`);
  if (counts.missing) reasons.push(`${plural(counts.missing, 'fact')} missing`);
  if (counts.unverified) reasons.push(`${plural(counts.unverified, 'fact')} not verified`);
  if (inv.high) reasons.push(`${plural(inv.high, 'unsupported statement')} that could change what the reader does`);
  if (missingTerms.length) reasons.push(`${plural(missingTerms.length, 'protected term')} not kept exactly`);
  const serious = reasons.length > 0;
  if (counts.review) reasons.push(`${plural(counts.review, 'fact')} to review`);
  if (inv.low) reasons.push(`${plural(inv.low, 'possible unsupported statement')}`);

  const outcome: Outcome = serious ? 'issues' : reasons.length ? 'review' : 'clear';
  return {
    outcome,
    reasons,
    counts,
    criticalProblems,
    inventions: inv,
    missingTerms,
    coverage: total ? earned / total - inv.high * 0.1 - inv.low * 0.03 - missingTerms.length * 0.1 : 0,
  };
}

const OUTCOME_RANK: Record<Outcome, number> = { clear: 2, review: 1, issues: 0 };

export function betterRound<T extends { assessment: Assessment }>(a: T, b: T): T {
  const ra = OUTCOME_RANK[a.assessment.outcome];
  const rb = OUTCOME_RANK[b.assessment.outcome];
  if (ra !== rb) return ra > rb ? a : b;
  return a.assessment.coverage > b.assessment.coverage ? a : b;
}

// Items a human reviewer should look at: anything not cleanly matched, and every unsupported statement.
export function flaggedItems(results: ClaimResult[], inventions: Invention[]): string[] {
  return [...results.filter((r) => findingOf(r) !== 'matched').map((r) => r.id), ...inventions.map((_, i) => `inv${i}`)];
}

export function reviewStatus(results: ClaimResult[], inventions: Invention[], decisions: ReviewDecision[]) {
  const flagged = flaggedItems(results, inventions);
  const done = new Set(decisions.map((d) => d.item));
  const reviewed = flagged.filter((k) => done.has(k)).length;
  const status: 'not-reviewed' | 'partially-reviewed' | 'reviewed' =
    decisions.length === 0 ? 'not-reviewed' : reviewed >= flagged.length ? 'reviewed' : 'partially-reviewed';
  return { status, flagged: flagged.length, reviewed };
}
