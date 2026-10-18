import path from 'node:path';
import type { Endpoint } from '@/lib/engine/llm';
import type { EngineDeps } from '@/lib/engine/pipeline';
import { setPreviewResponder } from '@/lib/engine/llm';
import { previewRespond } from '@/lib/engine/preview';

const env = process.env;
const num = (v: string | undefined, d: number) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);
const flag = (v: string | undefined) => /^(1|true|yes|on)$/i.test(v ?? '');
const trimUrl = (u: string | undefined) => (u ?? '').trim().replace(/\/+$/, '');

const baseUrl = trimUrl(env.LLM_BASE_URL);
const jsonMode = (['json_schema', 'json_object', 'none'].includes(env.LLM_JSON_MODE ?? '') ? env.LLM_JSON_MODE : 'json_schema') as Endpoint['jsonMode'];

export const config = {
  preview: !baseUrl,
  llm: {
    kind: baseUrl ? 'http' : 'preview',
    baseUrl,
    apiKey: env.LLM_API_KEY ?? '',
    model: env.LLM_MODEL ?? '',
    jsonMode,
    timeoutMs: num(env.LLM_TIMEOUT_MS, 180_000),
    maxRetries: num(env.LLM_MAX_RETRIES, 3),
  } as Endpoint,
  verifier: {
    kind: baseUrl ? 'http' : 'preview',
    baseUrl: trimUrl(env.VERIFIER_BASE_URL) || baseUrl,
    apiKey: env.VERIFIER_API_KEY || env.LLM_API_KEY || '',
    model: env.VERIFIER_MODEL ?? '',
    jsonMode,
    timeoutMs: num(env.LLM_TIMEOUT_MS, 180_000),
    maxRetries: num(env.LLM_MAX_RETRIES, 3),
  } as Endpoint,
  vision: flag(env.LLM_VISION),
  hardware: env.HARDWARE_LABEL || 'AMD Instinct MI300X · ROCm · vLLM',
  gpuHourlyUsd: num(env.GPU_HOURLY_USD, 1.99),
  tts: {
    baseUrl: trimUrl(env.TTS_BASE_URL),
    apiKey: env.TTS_API_KEY ?? '',
    model: env.TTS_MODEL || 'kokoro',
    voices: (env.TTS_VOICES || 'af_heart,am_michael,bf_emma').split(',').map((v) => v.trim()).filter(Boolean),
    languages: (env.TTS_LANGUAGES || 'en').split(',').map((v) => v.trim()).filter(Boolean),
    label: env.TTS_LABEL || 'Neural voice',
  },
  ocr: { langs: env.OCR_LANGS || 'eng', maxPages: num(env.OCR_MAX_PAGES, 8) },
  limits: {
    maxUploadBytes: num(env.MAX_UPLOAD_MB, 15) * 1024 * 1024,
    maxChars: num(env.MAX_SOURCE_CHARS, 30_000),
    minChars: 40,
    maxClaims: num(env.MAX_CLAIMS, 40),
    verifyBatch: num(env.VERIFY_BATCH, 12),
    maxRepairs: 3,
  },
  retentionHours: num(env.RETENTION_HOURS, 72),
  dataDir: env.DATA_DIR || path.join(process.cwd(), 'data'),
  previewDelayMs: num(env.PREVIEW_DELAY_MS, 18),
};

setPreviewResponder(previewRespond, config.previewDelayMs);

let resolved: Promise<void> | null = null;

// vLLM lists the served model at /models, so LLM_MODEL can be left unset.
async function resolveModels() {
  if (config.preview) return;
  if (!config.llm.model) {
    const headers: Record<string, string> = config.llm.apiKey ? { Authorization: `Bearer ${config.llm.apiKey}` } : {};
    const res = await fetch(`${config.llm.baseUrl}/models`, { headers, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`The model endpoint answered ${res.status} when listing models.`);
    const id = (await res.json()).data?.[0]?.id;
    if (!id) throw new Error('The model endpoint lists no models. Set LLM_MODEL.');
    config.llm.model = id;
  }
  if (!config.verifier.model) config.verifier.model = config.llm.model;
}

export async function engineDeps(): Promise<EngineDeps> {
  resolved ??= resolveModels().catch((err) => {
    resolved = null;
    throw err;
  });
  await resolved;
  return {
    endpoint: config.llm,
    verifierEndpoint: config.verifier,
    gpuHourlyUsd: config.gpuHourlyUsd,
    maxClaims: config.limits.maxClaims,
    verifyBatch: config.limits.verifyBatch,
    info: engineInfo(),
  };
}

export function engineInfo() {
  let endpoint = '';
  try {
    endpoint = config.preview ? 'in-process' : new URL(config.llm.baseUrl).host;
  } catch {
    endpoint = '';
  }
  return {
    mode: config.preview ? ('preview' as const) : ('model' as const),
    writerModel: config.preview ? 'Preview Mode (rule-based, no AI model)' : config.llm.model || 'auto',
    verifierModel: config.preview ? 'Preview Mode (lexical checks)' : config.verifier.model || config.llm.model || 'auto',
    endpoint,
    hardware: config.preview ? 'none' : config.hardware,
    semantic: !config.preview,
  };
}

export function publicHealth() {
  const info = engineInfo();
  return {
    ...info,
    vision: config.vision && !config.preview,
    tts: config.tts.baseUrl ? { available: true, label: config.tts.label, voices: config.tts.voices, languages: config.tts.languages } : { available: false },
    ocr: { langs: config.ocr.langs },
    limits: { maxUploadMb: Math.round(config.limits.maxUploadBytes / 1024 / 1024), maxChars: config.limits.maxChars, maxRepairs: config.limits.maxRepairs },
    retentionHours: config.retentionHours,
    gpuHourlyUsd: config.gpuHourlyUsd,
  };
}
