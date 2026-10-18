// Text utilities shared by the server and the browser: quote matching, sentences, paragraphs,
// numbers and readability. Everything here is deterministic.

const FOLD: Record<string, string> = {
  '‘': "'", '’': "'", '‚': "'", '“': '"', '”': '"', '„': '"',
  '«': '"', '»': '"', '–': '-', '—': '-', '−': '-', '‑': '-',
  ' ': ' ', ' ': ' ', '​': '', '‌': '', '‍': '', '‎': '', '‏': '',
};

// Arabic-Indic, Persian, Devanagari and Tamil digits -> ASCII, so numbers compare across scripts.
const DIGIT_BLOCKS = [0x0660, 0x06f0, 0x0966, 0x0be6];
const DIGIT_RE = /[٠-٩۰-۹०-९௦-௯]/g;

function foldDigit(ch: string): string {
  const c = ch.charCodeAt(0);
  for (const base of DIGIT_BLOCKS) if (c >= base && c <= base + 9) return String(c - base);
  return ch;
}

export function buildIndex(text: string): { norm: string; map: number[] } {
  let norm = '';
  const map: number[] = [];
  let prevSpace = true;
  for (let i = 0; i < text.length; i++) {
    let ch = foldDigit(FOLD[text[i]] ?? text[i]);
    if (!ch) continue;
    if (/\s/.test(ch)) {
      if (prevSpace) continue;
      ch = ' ';
      prevSpace = true;
    } else {
      prevSpace = false;
    }
    for (const c of ch.toLowerCase()) {
      norm += c;
      map.push(i);
    }
  }
  return { norm, map };
}

export function normalize(text: string | null | undefined): string {
  return buildIndex(String(text ?? '')).norm.trim();
}

export interface Span {
  start: number;
  end: number;
}

const EDGE = /^[\s"'.,;:!?()*\-[\]]+|[\s"'.,;:!?()*\-…[\]]+$/g;

// Locate `quote` inside `text`, ignoring case, whitespace runs and typographic quotes.
export function findQuote(text: string, quote: string): Span | null {
  if (!text || !quote) return null;
  const { norm, map } = buildIndex(text);
  let q = normalize(quote);
  if (!q) return null;
  let at = norm.indexOf(q);
  if (at < 0) {
    q = q.replace(EDGE, '');
    if (q.length < 3) return null;
    at = norm.indexOf(q);
  }
  if (at < 0) return null;
  return { start: map[at], end: map[at + q.length - 1] + 1 };
}

const ABBR = /\b(?:e\.g|i\.e|dr|mr|mrs|ms|no|vs|approx|tel|st|art|sig|prof|etc)\.$/i;

export interface Sentence extends Span {
  text: string;
}

export function splitSentences(text: string): Sentence[] {
  const out: Sentence[] = [];
  const push = (start: number, end: number) => {
    const raw = text.slice(start, end);
    const lead = raw.length - raw.trimStart().length;
    const t = raw.trim();
    if (t) out.push({ text: t, start: start + lead, end: start + lead + t.length });
  };
  let start = 0;
  const re = /[。！？]+|[.!?؟۔।]+["'”’)\]]*(?=\s|$)|\n+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const isBreak = m[0][0] === '\n';
    const end = isBreak ? m.index : m.index + m[0].length;
    if (!isBreak && ABBR.test(text.slice(start, end))) continue;
    push(start, end);
    start = m.index + m[0].length;
  }
  push(start, text.length);
  return out;
}

export interface Paragraph extends Span {
  index: number;
  text: string;
}

// Paragraphs are separated by blank lines; a document without blank lines is split by line.
export function splitParagraphs(text: string): Paragraph[] {
  const sep = /\n\s*\n/.test(text) ? /\n\s*\n/g : /\n/g;
  const out: Paragraph[] = [];
  let start = 0;
  const push = (s: number, e: number) => {
    const raw = text.slice(s, e);
    const lead = raw.length - raw.trimStart().length;
    const t = raw.trim();
    if (t) out.push({ index: out.length + 1, text: t, start: s + lead, end: s + lead + t.length });
  };
  let m: RegExpExecArray | null;
  while ((m = sep.exec(text))) {
    push(start, m.index);
    start = m.index + m[0].length;
  }
  push(start, text.length);
  return out;
}

export function paragraphAt(paragraphs: Paragraph[], offset: number): number | null {
  const p = paragraphs.find((x) => offset >= x.start && offset < x.end);
  return p ? p.index : null;
}

const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, once: 1, twice: 2, thrice: 3,
};

export function canonNumber(raw: string): string {
  let s = raw.replace(/[.,](?=\d{3}(?:\D|$))/g, '');
  s = s.replace(',', '.');
  if (s.includes('.')) s = s.replace(/\.?0+$/, '');
  s = s.replace(/^0+(?=\d)/, '');
  return s;
}

// Canonical numeric tokens in a text. List markers ("1." at the start of a line) are ignored.
export function numbersIn(text: string | null | undefined, { words = false } = {}): Set<string> {
  const set = new Set<string>();
  const cleaned = String(text ?? '')
    .replace(DIGIT_RE, foldDigit)
    .replace(/^\s*\d{1,2}[.)]\s/gm, ' ');
  for (const m of cleaned.matchAll(/\d+(?:[.,]\d+)*/g)) set.add(canonNumber(m[0]));
  if (words) {
    for (const m of cleaned.toLowerCase().matchAll(/[a-z]+/g)) {
      if (Object.hasOwn(WORD_NUMBERS, m[0])) set.add(String(WORD_NUMBERS[m[0]]));
    }
  }
  return set;
}

const MONTHS = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
export const DATE_RE = new RegExp(
  `\\b(?:\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTHS})\\.?,?\\s+\\d{4}|(?:${MONTHS})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}|\\d{4}-\\d{2}-\\d{2}|\\d{1,2}[/.]\\d{1,2}[/.]\\d{2,4})\\b`,
  'i',
);
const MONTH_KEYS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// Canonical keys for the dates in a text ("25 October 2026" and "October 25, 2026" -> "25-10-2026"),
// so a changed month is caught even when every number stayed the same.
export function dateKeys(text: string | null | undefined): Set<string> {
  const keys = new Set<string>();
  for (const m of String(text ?? '').matchAll(new RegExp(DATE_RE.source, 'gi'))) {
    const s = m[0].toLowerCase();
    const month = MONTH_KEYS.findIndex((k) => s.includes(k));
    const nums = s.match(/\d+/g) ?? [];
    if (month >= 0 && nums.length >= 2) {
      keys.add(`${Number(nums[0])}-${month + 1}-${nums[nums.length - 1]}`);
    } else if (nums.length === 3) {
      const [a, b, c] = nums.map(Number);
      keys.add(String(a).length === 4 ? `${c}-${b}-${a}` : `${a}-${b}-${c}`);
    }
  }
  return keys;
}

export const MONEY_RE = /(?:(?:EUR|USD|GBP|INR|AED|SAR|LKR|Rs\.?|[$€£₹])\s?\d[\d.,]*|\d[\d.,]*\s?(?:EUR|USD|GBP|INR|AED|SAR|LKR|euros?|dollars?|pounds?|rupees?))/i;
export const PERCENT_RE = /\d+(?:[.,]\d+)?\s?%|\d+(?:[.,]\d+)?\s?per\s?cent/i;

function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (w.length <= 3) return 1;
  const m = w
    .replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '')
    .replace(/^y/, '')
    .match(/[aeiouy]{1,2}/g);
  return m ? m.length : 1;
}

export interface Readability {
  words: number;
  sentences: number;
  wordsPerSentence: number;
  grade: number;
}

// Word count plus Flesch-Kincaid grade. The grade is only meaningful for English.
export function readability(text: string): Readability {
  const sentences = splitSentences(text).length || 1;
  const words = String(text ?? '').match(/[\p{L}\p{M}'’]+/gu) || [];
  const syl = words.reduce((n, w) => n + syllables(w), 0);
  const perSentence = words.length / sentences;
  const grade = 0.39 * perSentence + 11.8 * (syl / Math.max(1, words.length)) - 15.59;
  return {
    words: words.length,
    sentences,
    wordsPerSentence: Math.round(perSentence * 10) / 10,
    grade: Math.max(0, Math.round(grade * 10) / 10),
  };
}

export function looksEnglish(text: string): boolean {
  const sample = text.slice(0, 4000).toLowerCase();
  const hits = sample.match(/\b(the|and|you|of|to|is|for|your|must|will|be)\b/g)?.length ?? 0;
  const latin = (sample.match(/[a-z]/g)?.length ?? 0) / Math.max(1, sample.replace(/\s/g, '').length);
  return latin > 0.6 && hits >= 5;
}
