// AudienceDNA: reader profiles, tones and output languages.

export type ProfileId = 'child' | 'teen' | 'plain' | 'dyslexia' | 'esl' | 'senior';
export type ToneId = 'reassuring' | 'neutral' | 'urgent';
export type LanguageCode = 'source' | 'en' | 'ar' | 'ta';

export interface ReaderDefaults {
  font?: 'default' | 'lexend' | 'atkinson';
  size?: 'normal' | 'large' | 'xl';
  spacing?: 'normal' | 'wide';
  focus?: boolean;
}

export interface Profile {
  id: ProfileId;
  label: string;
  short: string;
  description: string;
  grade: number;
  brief: string;
  structure: string;
  voice: { rate: number; pitch: number; pauseMs: number };
  reader: ReaderDefaults;
}

export const PROFILES: Record<ProfileId, Profile> = {
  plain: {
    id: 'plain',
    label: 'Everyday reader',
    short: 'Everyday',
    description: 'Clear, natural plain language.',
    grade: 7,
    brief:
      'An adult who wants plain language. Use active voice, common words, short sentences and "you". Put the most important thing first. Replace jargon with everyday words.',
    structure: 'Paragraphs of 2 to 3 sentences. Use a short heading ("## ") for each part of the document.',
    voice: { rate: 1, pitch: 1, pauseMs: 200 },
    reader: {},
  },
  teen: {
    id: 'teen',
    label: 'Teen',
    short: 'Teen',
    description: 'Approachable and direct, never childish.',
    grade: 7,
    brief:
      'A teenager aged 13 to 17. Be direct and respectful, with relatable wording and no slang or lecturing. Explain any technical term the first time it appears. Say clearly what they personally need to do.',
    structure: 'Very short paragraphs of 1 to 2 sentences. Open the explanation with one sentence saying why this matters to them.',
    voice: { rate: 1.02, pitch: 1.05, pauseMs: 150 },
    reader: {},
  },
  senior: {
    id: 'senior',
    label: 'Senior',
    short: 'Senior',
    description: 'Patient, clearly sectioned, warnings first.',
    grade: 7,
    brief:
      'An older adult. Be calm, patient and respectful, never childish. Give steps in the order they happen, numbered. Put warnings where they cannot be missed. End with one reminder of the single most important deadline or amount, using exactly the same numbers.',
    structure:
      'Clear "## " headings for each part. Numbered steps ("1. ") for anything the reader must do. Avoid long lists of side details.',
    voice: { rate: 0.8, pitch: 0.95, pauseMs: 550 },
    reader: { size: 'large' },
  },
  child: {
    id: 'child',
    label: 'Child',
    short: 'Child',
    description: 'Ages 8 to 12, one idea at a time.',
    grade: 3,
    brief:
      'A child aged 8 to 12. Use very short sentences (12 words or fewer) and everyday words. One idea at a time. Be warm and direct. Never leave out a rule, number or warning because it seems too serious for a child.',
    structure: 'One or two sentences per paragraph.',
    voice: { rate: 0.95, pitch: 1.15, pauseMs: 300 },
    reader: {},
  },
  dyslexia: {
    id: 'dyslexia',
    label: 'Dyslexia-friendly',
    short: 'Dyslexia',
    description: 'One idea per line, clear structure.',
    grade: 6,
    brief:
      'A reader with dyslexia. One idea per sentence. Put the key information at the start of each sentence. Avoid long or unusual words, abbreviations, italics and double negatives.',
    structure: 'Use "- " bullet points for almost everything. Paragraphs of at most 2 short sentences.',
    voice: { rate: 0.85, pitch: 1, pauseMs: 650 },
    reader: { font: 'lexend', spacing: 'wide', focus: true },
  },
  esl: {
    id: 'esl',
    label: 'Language learner',
    short: 'Learner',
    description: 'Common words, no idioms (CEFR A2 to B1).',
    grade: 5,
    brief:
      'An adult still learning this language (CEFR A2 to B1). Use the most common words. No idioms, no phrasal verbs where a simple verb exists, no cultural references. Keep the subject of every sentence explicit. Prefer the present tense.',
    structure: 'One sentence per line. Repeat the key noun instead of using "it" or "this" when the meaning could be unclear.',
    voice: { rate: 0.85, pitch: 1, pauseMs: 450 },
    reader: {},
  },
};

export const PROFILE_ORDER: ProfileId[] = ['plain', 'teen', 'senior', 'child', 'dyslexia', 'esl'];

export const TONES: Record<ToneId, { label: string; brief: string }> = {
  neutral: { label: 'Neutral', brief: 'Plain and matter-of-fact.' },
  reassuring: {
    label: 'Reassuring',
    brief: 'Calm and supportive in wording. Do not promise outcomes and do not play down any warning.',
  },
  urgent: {
    label: 'Urgent',
    brief: 'Make deadlines and consequences impossible to miss. Lead with what must happen and by when.',
  },
};

export interface Language {
  code: LanguageCode;
  label: string;
  name: string;
  bcp: string;
  rtl?: boolean;
  needsModel: boolean;
}

export const LANGUAGES: Language[] = [
  { code: 'source', label: 'Keep original language', name: 'the language of the original document', bcp: '', needsModel: false },
  { code: 'en', label: 'English', name: 'English', bcp: 'en-US', needsModel: false },
  { code: 'ar', label: 'العربية · Arabic', name: 'Arabic', bcp: 'ar-SA', rtl: true, needsModel: true },
  { code: 'ta', label: 'தமிழ் · Tamil', name: 'Tamil', bcp: 'ta-IN', needsModel: true },
];

export const languageOf = (code: string): Language => LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[0];

export const SENSITIVE_DOMAINS = ['medical', 'legal', 'financial', 'government', 'insurance'];

export interface Labels {
  overview: string;
  changes: string;
  actions: string;
  warnings: string;
  keyFacts: string;
  explanation: string;
  definitions: string;
  official: string;
}

const LABELS: Record<'en' | 'ar' | 'ta', Labels> = {
  en: {
    overview: 'In short',
    changes: 'What changed',
    actions: 'What you need to do',
    warnings: 'Important warnings',
    keyFacts: 'Key dates and amounts',
    explanation: 'The details',
    definitions: 'Words explained',
    official:
      'This is a simplified version. The original document is the official source. If anything is unclear, check the original or ask the organisation that sent it.',
  },
  ar: {
    overview: 'باختصار',
    changes: 'ما الذي تغيّر',
    actions: 'ما الذي عليك فعله',
    warnings: 'تحذيرات مهمة',
    keyFacts: 'تواريخ ومبالغ مهمة',
    explanation: 'التفاصيل',
    definitions: 'شرح الكلمات',
    official:
      'هذه نسخة مبسطة. المستند الأصلي هو المصدر الرسمي. إذا كان هناك شيء غير واضح، راجع المستند الأصلي أو اسأل الجهة التي أرسلته.',
  },
  ta: {
    overview: 'சுருக்கமாக',
    changes: 'என்ன மாறியது',
    actions: 'நீங்கள் செய்ய வேண்டியவை',
    warnings: 'முக்கிய எச்சரிக்கைகள்',
    keyFacts: 'முக்கிய தேதிகள் மற்றும் தொகைகள்',
    explanation: 'விவரங்கள்',
    definitions: 'சொற்களின் விளக்கம்',
    official:
      'இது எளிமைப்படுத்தப்பட்ட பதிப்பு. மூல ஆவணமே அதிகாரப்பூர்வ ஆதாரம். ஏதேனும் தெளிவாக இல்லையெனில், மூல ஆவணத்தைப் பார்க்கவும் அல்லது அதை அனுப்பிய நிறுவனத்திடம் கேளுங்கள்.',
  },
};

export const labelsFor = (code: string): Labels => LABELS[code as 'en' | 'ar' | 'ta'] ?? LABELS.en;

// Which label set the reader sees: the output language, or for "keep original" the document's own.
export function outputLabelCode(language: string, sourceLanguage: string): 'en' | 'ar' | 'ta' {
  if (language === 'ar' || language === 'ta' || language === 'en') return language;
  if (/arabic/i.test(sourceLanguage)) return 'ar';
  if (/tamil/i.test(sourceLanguage)) return 'ta';
  return 'en';
}

export function outputBcp(language: string, sourceLanguage: string): string {
  return languageOf(outputLabelCode(language, sourceLanguage)).bcp;
}

export function isRtl(language: string, sourceLanguage: string): boolean {
  return outputLabelCode(language, sourceLanguage) === 'ar';
}
