// ActionLens: tasks, deadlines and warnings, each linked to claims from the original document.
// Nothing here is invented: an item that cannot be linked to a claim is not listed as an action.

import { findQuote, DATE_RE, MONEY_RE, PERCENT_RE } from './text';
import { findingOf } from './scoring';
import type { Adapted, AdaptedItem, Claim, ClaimResult, Finding } from './types';

export type ActionKind = 'task' | 'payment' | 'deadline' | 'appointment' | 'document' | 'warning' | 'eligibility';

export interface ActionItem {
  id: string;
  kind: ActionKind;
  text: string;
  claimIds: string[];
  deadline: string | null;
  amount: string | null;
  paragraphs: number[];
  finding: Finding;
  derived: boolean;
}

const RANK: Record<Finding, number> = { matched: 0, review: 1, unverified: 2, missing: 3, mismatch: 4 };
const worst = (fs: Finding[]) => fs.reduce<Finding>((w, f) => (RANK[f] > RANK[w] ? f : w), 'matched');

function kindOf(claims: Claim[], fallback: ActionKind): ActionKind {
  const types = claims.map((c) => c.type);
  if (fallback === 'warning') return types.includes('eligibility') ? 'eligibility' : 'warning';
  if (types.includes('money') && claims.some((c) => /\b(pay|paid|payment|owe|due|fee|deposit|balance)\b/i.test(c.text))) return 'payment';
  if (types.includes('appointment')) return 'appointment';
  if (types.includes('document')) return 'document';
  if (types.includes('deadline')) return 'deadline';
  return 'task';
}

function deadlineOf(claims: Claim[]): string | null {
  for (const c of claims) {
    const date = c.values.find((v) => DATE_RE.test(v)) ?? c.text.match(DATE_RE)?.[0];
    if (date) return date;
  }
  for (const c of claims) {
    if (c.type !== 'deadline') continue;
    const rel = c.text.match(/\b(?:within|before|by)\s+\d+\s+(?:days?|weeks?|months?)[^.,;]*/i)?.[0];
    if (rel) return rel.trim();
  }
  return null;
}

function amountOf(claims: Claim[]): string | null {
  for (const c of claims) {
    const v = c.values.find((x) => MONEY_RE.test(x) || PERCENT_RE.test(x));
    if (v) return v;
  }
  return null;
}

function link(item: AdaptedItem, claimsById: Map<string, Claim>, results: ClaimResult[]): string[] {
  const tagged = item.claims.filter((id) => claimsById.has(id));
  if (tagged.length) return tagged;
  // Untagged item: link it through the verifier's evidence quotes, if one sits inside it.
  return results.filter((r) => r.evidence && findQuote(item.text, r.evidence)).map((r) => r.id);
}

export function deriveActions(version: Adapted, claims: Claim[], results: ClaimResult[]) {
  const claimsById = new Map(claims.map((c) => [c.id, c]));
  const resultById = new Map(results.map((r) => [r.id, r]));
  let unlinked = 0;

  const build = (items: AdaptedItem[], prefix: string, fallback: ActionKind): ActionItem[] => {
    const out: ActionItem[] = [];
    items.forEach((item, i) => {
      const ids = link(item, claimsById, results);
      if (!ids.length) {
        unlinked++;
        return;
      }
      const linked = ids.map((id) => claimsById.get(id)!);
      out.push({
        id: `${prefix}${i}`,
        kind: kindOf(linked, fallback),
        text: item.text,
        claimIds: ids,
        deadline: deadlineOf(linked),
        amount: amountOf(linked),
        paragraphs: [...new Set(linked.map((c) => c.paragraph).filter((p): p is number => p != null))],
        finding: worst(ids.map((id) => findingOf(resultById.get(id)))),
        derived: false,
      });
    });
    return out;
  };

  let actions = build(version.actions, 'a', 'task');
  const warnings = build(version.warnings, 'w', 'warning');

  // The writer listed no actions: fall back to the action-type claims themselves.
  if (!version.actions.length) {
    actions = claims
      .filter((c) => ['instruction', 'deadline', 'appointment', 'document'].includes(c.type) || (c.type === 'money' && /\b(pay|owe|due)\b/i.test(c.text)))
      .map((c, i) => {
        const r = resultById.get(c.id);
        return {
          id: `d${i}`,
          kind: kindOf([c], 'task'),
          text: r?.evidence || c.text,
          claimIds: [c.id],
          deadline: deadlineOf([c]),
          amount: amountOf([c]),
          paragraphs: c.paragraph != null ? [c.paragraph] : [],
          finding: findingOf(r),
          derived: true,
        };
      });
  }
  return { actions, warnings, unlinked };
}

export function checklistText(title: string, actions: ActionItem[], done: string[]): string {
  const lines = [`${title}`, `Checklist exported from PlainProof on ${new Date().toISOString().slice(0, 10)}`, ''];
  for (const a of actions) {
    const meta = [a.deadline && `Deadline: ${a.deadline}`, a.amount && `Amount: ${a.amount}`, a.paragraphs.length && `Source: paragraph ${a.paragraphs.join(', ')}`]
      .filter(Boolean)
      .join(' · ');
    lines.push(`[${done.includes(a.id) ? 'x' : ' '}] ${a.text}${meta ? `\n    ${meta}` : ''}`);
  }
  lines.push('', 'The original document is the official source.');
  return lines.join('\n');
}
