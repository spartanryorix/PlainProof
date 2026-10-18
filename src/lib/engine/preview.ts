// Preview Mode: rule-based stand-ins for the agents, used only when no AI model is configured.
// It is NOT a language model. It rewords with a fixed dictionary, restructures per audience,
// cannot translate, and its "verification" is a lexical and numeric comparison, not a semantic
// one. Every preview result is labelled as such and its receipt says "Semantic verification not
// performed". A first draft is deliberately imperfect so the repair loop can be exercised.

import type { Agent, ChatMessage } from './llm';
import { parseAdapted, serializeAdapted } from './adapted';
import { DATE_RE, MONEY_RE, PERCENT_RE, dateKeys, looksEnglish, numbersIn, splitSentences } from './text';
import type { Adapted, AdaptedItem, ClaimType, Criticality } from './types';

const tagOf = (text: string, name: string) => text.match(new RegExp(`<${name}>\\n([\\s\\S]*?)\\n</${name}>`))?.[1] ?? '';
function jsonTag<T>(text: string, name: string, fallback: T): T {
  try {
    return JSON.parse(tagOf(text, name)) as T;
  } catch {
    return fallback;
  }
}

const SIMPLE: [string, string][] = [
  ['prior to commencing', 'before you start'], ['prior to', 'before'], ['commencing', 'starting'], ['commencement of', 'start of'],
  ['administered', 'taken'], ['concomitant consumption of', 'drinking'], ['is contraindicated in patients with', 'must not be taken by people with'],
  ['hepatic impairment', 'liver problems'], ['physician', 'doctor'], ['discontinue', 'stop'], ['seek immediate medical attention', 'get medical help immediately'],
  ['indicated for', 'used for'], ['adolescents', 'young people'], ['inform', 'tell'], ['the duration of treatment is', 'the treatment lasts'],
  ['twice daily', '2 times a day'], ['anticoagulant medication', 'blood-thinning medicine'], ['consult', 'talk to'],
  ['has determined that', 'has found that'], ['insufficient', 'too low'], ['comprising', 'made up of'], ['outstanding balance', 'amount you still owe'],
  ['accrued statutory interest', 'interest'], ['late-payment surcharge', 'late fee'], ['must be received no later than', 'must arrive by'],
  ['no later than', 'by'], ['you are unable to', 'you cannot'], ['is subject to approval', 'must be approved'],
  ['you have the right to lodge an appeal', 'you can appeal'], ['lodging an appeal', 'appealing'], ['within 60 days of receipt of this notice', 'within 60 days after you get this notice'],
  ['does not suspend the obligation to pay', 'does not stop you having to pay'], ['failure to', 'if you do not'], ['will result in', 'will lead to'],
  ['enforced collection proceedings', 'forced collection'], ['without further notice', 'with no more warning'], ['for assistance', 'for help'],
  ['quoting', 'giving'], ['following a review of', 'after checking'], ['approximately', 'about'], ['accommodation', 'a place to stay'],
  ['non-refundable', 'not returnable'], ['payable by', 'to be paid by'], ['in receipt of', 'who get'], ['in confidence', 'privately'],
  ['will not be permitted to', 'will not be allowed to'], ['prescribed medication', 'medicine from a doctor'], ['will be held', 'will take place'],
  ['in person', 'yourself'], ['may apply', 'can ask'], ['submitted in writing', 'sent in writing'], ['additional', 'extra'],
  ['policyholder', 'person with the policy'], ['policyholders', 'people with the policy'], ['premium', 'monthly price'], ['effective from', 'starting on'],
  ['reimbursement', 'money paid back'], ['reimbursed', 'paid back'], ['eligible', 'able to get it'], ['coverage', 'cover'], ['terminate', 'end'],
  ['notwithstanding', 'even with'], ['pursuant to', 'under'], ['in accordance with', 'following'], ['subsequently', 'later'], ['commence', 'start'],
  ['remittance', 'payment'], ['arrears', 'unpaid amount'], ['documentation', 'papers'], ['in the event that', 'if'], ['with respect to', 'about'],
  ['is required to', 'must'], ['are required to', 'must'], ['utilise', 'use'], ['utilize', 'use'], ['obtain', 'get'], ['sufficient', 'enough'],
];

const GLOSSARY: Record<string, string> = {
  deductible: 'The amount you pay yourself before the insurance starts paying.',
  premium: 'The regular price you pay for insurance.',
  appeal: 'Asking an official body to look at a decision again.',
  instalments: 'Smaller payments spread over time instead of one big payment.',
  penalty: 'Extra money you have to pay because a rule was not followed.',
  interest: 'Extra money added to an amount that is paid late.',
  deposit: 'A first part of a payment, paid in advance.',
  dose: 'The amount of medicine you take at one time.',
  'consent form': 'A paper you sign to say you agree.',
  claim: 'A request to the insurer to pay for something.',
  'side effects': 'Unwanted things a medicine can do to your body.',
};

function simplify(text: string): string {
  let out = text;
  for (const [from, to] of SIMPLE) {
    out = out.replace(new RegExp(`\\b${from}\\b`, 'gi'), (m) => (m[0] === m[0].toUpperCase() ? to[0].toUpperCase() + to.slice(1) : to));
  }
  out = out.replace(/\s+/g, ' ').trim();
  return /[.!?]$/.test(out) ? out : `${out}.`;
}

// Short sentences for young readers: split at semicolons and at ", and".
const splitShort = (s: string) =>
  s
    .split(/;\s+|,\s+and\s+(?=[a-z]+\s)/)
    .map((x) => x.trim().replace(/[,;]$/, ''))
    .filter(Boolean)
    .map((x) => (/[.!?]$/.test(x) ? x : `${x}.`))
    .map((x) => x[0].toUpperCase() + x.slice(1));

const VALUE_RE = /(?:(?:EUR|USD|GBP|INR|AED|[$€£₹])\s?)?\d+(?:[.,:/]\d+)*(?:\s?(?:%|per cent|mg|ml|mcg|kg|g|°C|tablets?|capsules?|times|hours?|days?|weeks?|months?|years?|minutes?|instalments?|euros?|EUR|USD|am|pm)\b|%)?(?:\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)(?:\s+\d{4})?)?/gi;

export function classify(t: string): [ClaimType, Criticality] {
  const l = t.toLowerCase();
  const num = /\d/.test(l);
  if (PERCENT_RE.test(t)) return ['percentage', 'critical'];
  if (num && /\b(mg|ml|mcg|tablets?|capsules?|doses?)\b/.test(l)) return ['dose', 'critical'];
  if (/\b(no later than|deadline|due by|due date|by the due date)\b/.test(l) || (num && /\b(by|before|within|until)\s+\d/.test(l))) return ['deadline', 'critical'];
  if (/\b(unless|except|exception|does not apply|not available for|only if|provided that)\b/.test(l)) return ['exception', 'critical'];
  if (/\b(eligible|eligibility|qualify|entitled)\b/.test(l)) return ['eligibility', 'critical'];
  if (num && MONEY_RE.test(t)) return ['money', 'critical'];
  if (/\b(do not|must not|never|warning|penalty|failure to|will result in|immediately|seek|avoid|not be permitted)\b/.test(l)) return ['warning', 'critical'];
  if (/\b(appointment|information evening|meeting)\b/.test(l)) return ['appointment', 'important'];
  if (/\b(changes?|changed|new|updated?|increase[sd]?|decrease[sd]?|replac\w+|from now on)\b/.test(l)) return ['change', 'important'];
  if (/\b(form|bring|provide|enclose|attach|proof of)\b/.test(l)) return ['document', 'important'];
  if (/\b(call|phone|telephone|contact|email|e-mail)\b|@|www\./.test(l)) return ['contact', 'important'];
  if (/\b(must|should|need to|please|pay|send|take|swallow|keep|store|return|complete|apply|submit|sign|tell)\b/.test(l)) return ['instruction', 'important'];
  if (/\bif\b/.test(l)) return ['condition', 'important'];
  if (num) return ['date', 'important'];
  return ['fact', 'background'];
}

const titleCase = (s: string) => s.toLowerCase().replace(/\b(?!(?:of|and|for|the|to|in|on|a|an)\b)\p{L}/gu, (c) => c.toUpperCase());

function docTitle(source: string) {
  const first = source.split('\n').map((x) => x.trim()).find(Boolean) ?? '';
  if (!first || first.length > 90) return 'Your document';
  return first === first.toUpperCase() ? titleCase(first) : first;
}

function extract(source: string) {
  const claims = [];
  for (const s of splitSentences(source)) {
    const text = s.text.trim();
    if (text.length < 25 || !/[.!?]["')]?$/.test(text) || text === text.toUpperCase()) continue;
    const [type, criticality] = classify(text);
    claims.push({ text, type, criticality, source_quote: text, values: [...new Set((text.match(VALUE_RE) ?? []).map((v) => v.trim()))] });
    if (claims.length >= 40) break;
  }
  const l = source.toLowerCase();
  const domain = /\b(insurance|policy|premium|deductible|insurer)\b/.test(l)
    ? 'insurance'
    : /\b(tablet|dose|medicine|patient|leaflet)\b/.test(l)
      ? 'medical'
      : /\b(tax|revenue|municipal|court)\b/.test(l)
        ? 'government'
        : /\b(school|pupil|parent|student)\b/.test(l)
          ? 'education'
          : /\b(bank|loan|account|interest rate)\b/.test(l)
            ? 'financial'
            : 'general';
  return { domain, title: docTitle(source), language: looksEnglish(source) ? 'English' : 'Unknown', claims };
}

interface PClaim {
  id: string;
  text: string;
  type: ClaimType;
  criticality: Criticality;
  values: string[];
}

interface Reader {
  profile: string;
  grade: number;
  tone: string;
  storyMode: boolean;
}

const softened = (s: string) => (/\bmust\b/i.test(s) ? s.replace(/\bmust\b/i, 'should try to') : s.replace(/\bdo not\b/i, 'try not to'));

function compose(claims: PClaim[], reader: Reader, source: string, lossy: boolean): Adapted {
  let drop = -1;
  let soften = -1;
  if (lossy) {
    drop = claims.findIndex((c, i) => i > 1 && c.criticality !== 'critical');
    soften = claims.findIndex((c, i) => i !== drop && /\b(must|do not)\b/i.test(c.text));
  }
  const kept = claims
    .map((c, i) => ({ c, s: i === soften ? softened(simplify(c.text)) : simplify(c.text) }))
    .filter((_, i) => i !== drop);
  const item = (x: { c: PClaim; s: string }): AdaptedItem => ({ text: x.s, claims: [x.c.id] });
  const has = (x: { c: PClaim }, re: RegExp) => x.c.values.some((v) => re.test(v)) || re.test(x.c.text);

  const p = reader.profile;
  const actions = kept.filter((x) => ['instruction', 'deadline', 'appointment', 'document'].includes(x.c.type) || (x.c.type === 'money' && /\bpay|due|owe\b/i.test(x.c.text)));
  const warnings = kept.filter((x) => ['warning', 'exception', 'eligibility', 'dose'].includes(x.c.type));
  const changes = kept.filter((x) => x.c.type === 'change');
  const keyFacts = kept.filter((x) => has(x, DATE_RE) || has(x, MONEY_RE) || has(x, PERCENT_RE));
  const background = kept.filter((x) => x.c.criticality === 'background');

  const lead: Record<string, string> = {
    plain: 'This document explains',
    teen: 'Here is the short version.',
    senior: 'This document is important. Please read it carefully.',
    child: 'Here is what this paper says, in simple words.',
    dyslexia: 'Here are the main points.',
    esl: 'This document is about the following.',
  };
  const tone = reader.tone === 'urgent' ? ' Some things have a deadline.' : reader.tone === 'reassuring' ? ' Take your time; each step is explained below.' : '';
  const overviewFacts = (background.length ? background : kept).slice(0, p === 'plain' ? 2 : 1).map((x) => x.s);
  const overview = p === 'plain' ? `${overviewFacts.join(' ')}${tone}` : `${lead[p] ?? ''}${tone} ${overviewFacts.join(' ')}`.trim();

  const lines: string[] = [];
  if (reader.storyMode) lines.push('Sam and Aunt Rosa read this paper together at the kitchen table. This is what it says.', '');
  const all = kept.map((x) => x.s);
  switch (p) {
    case 'child':
      for (const s of all) lines.push(...splitShort(s), '');
      break;
    case 'dyslexia':
      for (const s of all) lines.push(`- ${s}`);
      break;
    case 'esl':
      for (const s of all) lines.push(...splitShort(s));
      break;
    case 'senior': {
      if (actions.length) {
        lines.push('## Steps to follow');
        actions.forEach((x, i) => lines.push(`${i + 1}. ${x.s}`));
        lines.push('');
      }
      lines.push('## The details');
      const rest = kept.filter((x) => !actions.includes(x)).map((x) => x.s);
      for (let i = 0; i < rest.length; i += 2) lines.push(rest.slice(i, i + 2).join(' '), '');
      const key = kept.find((x) => x.c.type === 'deadline') ?? kept.find((x) => x.c.criticality === 'critical');
      if (key) lines.push('## Reminder', key.s);
      break;
    }
    case 'teen':
      for (let i = 0; i < all.length; i += 2) lines.push(all.slice(i, i + 2).join(' '), '');
      break;
    default:
      for (let i = 0; i < all.length; i += 3) lines.push(all.slice(i, i + 3).join(' '), '');
  }
  const explanation = lines.join('\n').trim();
  const lower = explanation.toLowerCase();
  return {
    title: `${docTitle(source)}: explained`,
    overview,
    changes: changes.map(item),
    actions: actions.slice(0, 6).map(item),
    warnings: warnings.slice(0, 6).map(item),
    keyFacts: keyFacts.slice(0, 8).map((x) => ({ text: x.s, claims: [x.c.id] })),
    explanation,
    definitions: Object.entries(GLOSSARY)
      .filter(([term]) => new RegExp(`\\b${term}\\b`).test(lower))
      .slice(0, 6)
      .map(([term, explanation]) => ({ term, explanation })),
  };
}

const STOP = new Set('the a an and or of to in on for with is are be this that it as at by if you your not from may any will have has been was were can must should than then these those their its which who'.split(' '));
const contentWords = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9][a-z0-9.,:/-]*[a-z0-9]|[a-z0-9]/g)?.filter((w) => w.length > 2 && !STOP.has(w)) ?? []);

function verifyLexically(claims: (PClaim & { source_quote?: string })[], adapted: string) {
  const sentences = splitSentences(adapted).map((s) => s.text.replace(/^[-•]\s*|^\d{1,2}[.)]\s*/, ''));
  return {
    results: claims.map((claim) => {
      const target = simplify(claim.source_quote || claim.text);
      const words = contentWords(target);
      let best = '';
      let bestRatio = 0;
      for (const s of sentences) {
        const sw = contentWords(s);
        let hit = 0;
        for (const w of words) if (sw.has(w)) hit++;
        const ratio = words.size ? hit / words.size : 0;
        if (ratio > bestRatio) [best, bestRatio] = [s, ratio];
      }
      if (bestRatio < 0.45) return { id: claim.id, status: 'missing', evidence: '', note: 'No sentence in the adapted text states this fact.', confidence: 0.9 };
      const want = [...numbersIn(claim.values.join(' ; '))];
      const have = numbersIn(best, { words: true });
      const lost = want.filter((n) => !have.has(n));
      if (lost.length) {
        const extra = [...numbersIn(best)].filter((n) => !numbersIn(target, { words: true }).has(n));
        return {
          id: claim.id,
          status: 'distorted',
          evidence: best,
          note: `Original: "${lost.join(', ')}". Adapted: ${extra.length ? `"${extra.join(', ')}"` : 'the number is not stated'}.`,
          confidence: 0.92,
        };
      }
      const wantDates = [...dateKeys(claim.values.join(' ; '))];
      const haveDates = dateKeys(best);
      const lostDates = wantDates.filter((k) => !haveDates.has(k));
      if (lostDates.length) {
        const shown = claim.values.filter((v) => [...dateKeys(v)].some((k) => lostDates.includes(k)));
        const instead = best.match(new RegExp(DATE_RE.source, 'i'))?.[0];
        return { id: claim.id, status: 'distorted', evidence: best, note: `Original: "${shown.join(', ')}". Adapted: ${instead ? `"${instead}"` : 'the date is not stated'}.`, confidence: 0.9 };
      }
      const strong = /\b(must|do not|never|unless|only if)\b/i;
      if (strong.test(target) && !strong.test(best)) {
        return { id: claim.id, status: 'weakened', evidence: best, note: `Original says "${target.match(strong)![0]}"; the adapted text is softer.`, confidence: 0.85 };
      }
      return { id: claim.id, status: 'preserved', evidence: best, note: '', confidence: Math.min(0.99, 0.5 + bestRatio / 2) };
    }),
  };
}

function inventionsByNumber(source: string, adapted: string) {
  const known = numbersIn(source, { words: true });
  const inventions = [];
  for (const s of splitSentences(adapted)) {
    const novel = [...numbersIn(s.text)].filter((n) => !known.has(n));
    if (!novel.length) continue;
    inventions.push({
      quote: s.text.replace(/^[-•]\s*|^\d{1,2}[.)]\s*/, ''),
      note: `The number ${novel.join(', ')} does not appear in the original.`,
      severity: MONEY_RE.test(s.text) || PERCENT_RE.test(s.text) || DATE_RE.test(s.text) || /\b(mg|tablets?|days?)\b/i.test(s.text) ? 'high' : 'low',
    });
  }
  return { inventions };
}

export function previewRespond(agent: Agent, messages: ChatMessage[]): string {
  const last = messages[messages.length - 1]?.content;
  const user = typeof last === 'string' ? last : '';
  const source = tagOf(user, 'document');
  const reader = jsonTag<Reader>(user, 'reader', { profile: 'plain', grade: 7, tone: 'neutral', storyMode: false });
  switch (agent) {
    case 'extractor':
      return JSON.stringify(extract(source));
    case 'writer':
    case 'repairer': {
      const claims = jsonTag<PClaim[]>(user, 'claims', []);
      const composed = compose(claims, reader, source, agent === 'writer');
      if (agent === 'writer') return serializeAdapted(composed);
      const previous = parseAdapted(tagOf(user, 'adapted'));
      return serializeAdapted({ ...composed, title: previous.title || composed.title });
    }
    case 'verifier':
      return JSON.stringify(verifyLexically(jsonTag(user, 'claims', []), tagOf(user, 'adapted')));
    case 'inventions':
      return JSON.stringify(inventionsByNumber(source, tagOf(user, 'adapted')));
    default:
      return 'Preview Mode cannot read images. Connect a multimodal model or use the built-in OCR.';
  }
}
