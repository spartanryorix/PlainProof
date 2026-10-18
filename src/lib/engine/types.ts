import type { LanguageCode, ProfileId, ToneId } from './profiles';

export const CLAIM_TYPES = [
  'deadline', 'money', 'percentage', 'dose', 'warning', 'instruction', 'appointment', 'document',
  'eligibility', 'exception', 'condition', 'date', 'contact', 'change', 'fact',
] as const;
export type ClaimType = (typeof CLAIM_TYPES)[number];

export const CRITICALITY = ['critical', 'important', 'background'] as const;
export type Criticality = (typeof CRITICALITY)[number];

export const DOMAINS = ['medical', 'insurance', 'financial', 'legal', 'government', 'education', 'employment', 'general'] as const;
export type Domain = (typeof DOMAINS)[number];

export interface Claim {
  id: string;
  text: string;
  type: ClaimType;
  criticality: Criticality;
  source_quote: string;
  values: string[];
  located: boolean;
  paragraph: number | null;
}

export const STATUSES = ['preserved', 'weakened', 'distorted', 'missing'] as const;
export type Status = (typeof STATUSES)[number];

export interface ClaimResult {
  id: string;
  status: Status;
  evidence: string;
  note: string;
  confidence: number;
  uncertain: boolean;
  unjudged: boolean;
  flags: string[];
}

export interface Invention {
  quote: string;
  note: string;
  severity: 'high' | 'low';
  source: 'detector' | 'guard';
}

// What a reader sees for each finding. Mapped from the engine status plus the guards' flags.
export type Finding = 'matched' | 'review' | 'mismatch' | 'missing' | 'unverified';

export interface AdaptedItem {
  text: string;
  claims: string[];
}

export interface Adapted {
  title: string;
  overview: string;
  changes: AdaptedItem[];
  actions: AdaptedItem[];
  warnings: AdaptedItem[];
  keyFacts: AdaptedItem[];
  explanation: string;
  definitions: { term: string; explanation: string }[];
}

export type Outcome = 'clear' | 'review' | 'issues';

export interface Assessment {
  outcome: Outcome;
  reasons: string[];
  counts: Record<Finding, number> & { total: number; critical: number; criticalMatched: number };
  criticalProblems: string[];
  inventions: { high: number; low: number };
  missingTerms: string[];
  coverage: number; // weighted, internal: used to rank rounds, never shown as an accuracy figure
}

export interface Round {
  round: number;
  kind: 'draft' | 'repair' | 'human-edit';
  version: Adapted;
  fault: Fault | null;
  results: ClaimResult[];
  inventions: Invention[];
  missingTerms: string[];
  assessment: Assessment;
}

export interface Fault {
  claimId: string;
  from: string;
  to: string;
  description: string;
}

export interface CostSummary {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  gpuSeconds: number;
  usd: number;
  gpuHourlyUsd: number;
  byAgent: Record<string, { calls: number; promptTokens: number; completionTokens: number; seconds: number }>;
  tokensEstimated: boolean;
  preview: boolean;
}

export interface RunRequest {
  profiles: { id: ProfileId; level?: number | null }[];
  language: LanguageCode;
  tone: ToneId;
  storyMode: boolean;
  protectedTerms: string[];
  maxRepairs: number;
  injectFault: boolean;
}

export interface EngineInfo {
  mode: 'model' | 'preview';
  writerModel: string;
  verifierModel: string;
  endpoint: string;
  hardware: string;
  semantic: boolean;
}

export type PipelineEvent =
  | { type: 'stage'; stage: 'extract'; status: 'active' | 'done' }
  | { type: 'claims'; claims: Claim[]; domain: Domain; title: string }
  | { type: 'phase'; profile: ProfileId; phase: 'writing' | 'verifying' | 'repairing'; round: number; targets?: string[]; problems?: number }
  | { type: 'delta'; profile: ProfileId; round: number; delta: string }
  | { type: 'draft'; profile: ProfileId; round: number; kind: Round['kind']; version: Adapted; fault: Fault | null }
  | { type: 'verified'; profile: ProfileId; round: number; results: ClaimResult[]; inventions: Invention[]; missingTerms: string[]; assessment: Assessment }
  | { type: 'final'; profile: ProfileId; versionId: string; round: number; receipt: Receipt; cost: CostSummary }
  | { type: 'cost'; cost: CostSummary }
  | { type: 'version-error'; profile: ProfileId; message: string }
  | { type: 'error'; message: string }
  | { type: 'done'; cost: CostSummary };

export interface ReviewDecision {
  item: string; // claim id, or inv<N>
  label: string;
  note?: string;
  reviewer?: string;
  at: string;
}

export interface Receipt {
  schema: 'plainproof.proofpass/2';
  receiptId: string;
  issuedAt: string;
  document: {
    id: string;
    title: string;
    filename: string | null;
    sha256: string;
    words: number;
    domain: Domain;
    extraction: string;
  };
  audience: { profile: ProfileId; label: string; language: LanguageCode; languageLabel: string; tone: ToneId; targetGrade: number; storyMode: boolean };
  adapted: { sha256: string; words: number; grade: number | null };
  engine: EngineInfo;
  verification: {
    semantic: boolean;
    statement: string;
    outcome: Outcome;
    reasons: string[];
    claimCount: number;
    criticalCount: number;
    counts: Assessment['counts'];
  };
  claims: (Claim & { finding: Finding; result: ClaimResult })[];
  inventions: Invention[];
  protectedTerms: { required: string[]; missing: string[] };
  rounds: { round: number; kind: Round['kind']; outcome: Outcome; problems: number }[];
  repairAttempts: number;
  selectedRound: number;
  unresolved: { item: string; label: string; finding: string }[];
  faultInjection: Fault | null;
  cost: CostSummary;
  humanReview: { status: 'not-reviewed' | 'partially-reviewed' | 'reviewed'; decisions: ReviewDecision[]; flaggedItems: number };
  limitations: string[];
  officialSourceNote: string | null;
}
