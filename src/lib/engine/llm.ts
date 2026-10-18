// OpenAI-compatible chat client (vLLM speaks this API) with structured outputs, retries,
// timeouts, rate-limit handling and token/GPU-time metering. In Preview Mode the same client
// talks to the in-process rule-based engine instead of HTTP.

import type { ZodType, ZodTypeDef } from 'zod';
import { stripThinking } from './adapted';
import type { CostSummary } from './types';

export type Agent = 'extractor' | 'writer' | 'verifier' | 'inventions' | 'repairer' | 'ocr';
export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string | unknown[] };

export interface Endpoint {
  kind: 'http' | 'preview';
  baseUrl: string;
  apiKey: string;
  model: string;
  jsonMode: 'json_schema' | 'json_object' | 'none';
  timeoutMs: number;
  maxRetries: number;
}

export type PreviewResponder = (agent: Agent, messages: ChatMessage[]) => string;

let previewResponder: PreviewResponder | null = null;
let previewDelayMs = 18;
export function setPreviewResponder(fn: PreviewResponder, delayMs?: number) {
  previewResponder = fn;
  if (delayMs !== undefined) previewDelayMs = delayMs;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (!ms) return resolve();
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(signal.reason ?? new Error('Aborted'));
    }, { once: true });
  });

const estimateTokens = (s: unknown) => Math.ceil(String(typeof s === 'string' ? s : JSON.stringify(s ?? '')).length / 4);
const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;

interface Call {
  agent: Agent;
  start: number;
  end: number | null;
  promptTokens: number;
  completionTokens: number;
  estimated: boolean;
}

// GPU time per call. Calls in flight at the same moment are batched on the same GPU, so each
// slice of wall-clock time is split evenly between them. Shares add up to the busy time.
function fairShares(calls: Call[], now: number) {
  const endOf = (c: Call) => c.end ?? now;
  const points = [...new Set(calls.flatMap((c) => [c.start, endOf(c)]))].sort((a, b) => a - b);
  const share = new Map<Call, number>(calls.map((c) => [c, 0]));
  for (let i = 0; i < points.length - 1; i++) {
    const active = calls.filter((c) => c.start <= points[i] && endOf(c) >= points[i + 1]);
    for (const c of active) share.set(c, share.get(c)! + (points[i + 1] - points[i]) / active.length);
  }
  return share;
}

export class Meter {
  calls: Call[] = [];
  constructor(
    private readonly gpuHourlyUsd: number,
    private readonly preview: boolean,
    private readonly parent: Meter | null = null,
  ) {}

  child() {
    return new Meter(this.gpuHourlyUsd, this.preview, this);
  }

  get root(): Meter {
    return this.parent ? this.parent.root : this;
  }

  open(agent: Agent): Call {
    const call: Call = { agent, start: Date.now(), end: null, promptTokens: 0, completionTokens: 0, estimated: false };
    for (let m: Meter | null = this; m; m = m.parent) m.calls.push(call);
    return call;
  }

  summary(): CostSummary {
    const share = fairShares(this.root.calls, Date.now());
    const byAgent: CostSummary['byAgent'] = {};
    let promptTokens = 0;
    let completionTokens = 0;
    let estimated = false;
    let gpuSeconds = 0;
    for (const c of this.calls) {
      const seconds = (share.get(c) ?? 0) / 1000;
      const a = (byAgent[c.agent] ??= { calls: 0, promptTokens: 0, completionTokens: 0, seconds: 0 });
      a.calls++;
      a.promptTokens += c.promptTokens;
      a.completionTokens += c.completionTokens;
      a.seconds = round(a.seconds + seconds, 2);
      promptTokens += c.promptTokens;
      completionTokens += c.completionTokens;
      estimated ||= c.estimated;
      gpuSeconds += seconds;
    }
    return {
      calls: this.calls.length,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      gpuSeconds: round(gpuSeconds, 2),
      usd: this.preview ? 0 : round((gpuSeconds / 3600) * this.gpuHourlyUsd, 6),
      gpuHourlyUsd: this.gpuHourlyUsd,
      byAgent,
      tokensEstimated: estimated,
      preview: this.preview,
    };
  }
}

export function parseJson(text: string): unknown {
  const cleaned = stripThinking(text)
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const a = cleaned.indexOf('{');
    const b = cleaned.lastIndexOf('}');
    if (a >= 0 && b > a) return JSON.parse(cleaned.slice(a, b + 1));
    throw new Error('The model did not return valid JSON.');
  }
}

export class ModelError extends Error {
  constructor(message: string, readonly retryable = false, readonly waitMs?: number) {
    super(message);
  }
}

async function readStream(res: Response, onDelta: (d: string) => void) {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let text = '';
  let usage: { prompt_tokens?: number; completion_tokens?: number } | null = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      try {
        const chunk = JSON.parse(data);
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) {
          text += delta;
          onDelta(delta);
        }
        if (chunk.usage) usage = chunk.usage;
      } catch {
        /* keep-alive or partial line */
      }
    }
  }
  return { text, usage };
}

async function previewCall(agent: Agent, messages: ChatMessage[], onDelta: ((d: string) => void) | undefined, signal?: AbortSignal) {
  if (!previewResponder) throw new ModelError('Preview engine is not available.');
  const text = previewResponder(agent, messages);
  if (onDelta) {
    const pieces = text.match(/\S+\s*/g) ?? [];
    for (let i = 0; i < pieces.length; i += 3) {
      onDelta(pieces.slice(i, i + 3).join(''));
      await sleep(previewDelayMs, signal);
    }
  } else {
    await sleep(Math.min(900, 200 + text.length / 8) * (previewDelayMs ? 1 : 0), signal);
  }
  return { text, usage: { prompt_tokens: estimateTokens(messages), completion_tokens: estimateTokens(text) } };
}

export interface ChatOptions<T> {
  agent: Agent;
  messages: ChatMessage[];
  schema?: { zod: ZodType<T, ZodTypeDef, unknown>; json: object; name: string };
  onDelta?: (delta: string) => void;
  maxTokens?: number;
  temperature?: number;
  meter?: Meter;
  signal?: AbortSignal;
  endpoint: Endpoint;
}

export async function chat<T = never>(opts: ChatOptions<T>): Promise<{ text: string; json: T | undefined }> {
  const { agent, schema, onDelta, meter, signal, endpoint } = opts;
  let messages = opts.messages;
  let useFormat = Boolean(schema) && endpoint.jsonMode !== 'none';
  let lastError: Error = new ModelError('The model call failed.');
  let jsonRetried = false;

  for (let attempt = 0; attempt <= endpoint.maxRetries; attempt++) {
    if (signal?.aborted) throw signal.reason ?? new Error('Aborted');
    const call = meter?.open(agent);
    let text: string;
    let usage: { prompt_tokens?: number; completion_tokens?: number } | null;
    try {
      if (endpoint.kind === 'preview') {
        ({ text, usage } = await previewCall(agent, messages, onDelta, signal));
      } else {
        const body: Record<string, unknown> = {
          model: endpoint.model,
          messages,
          temperature: opts.temperature ?? 0,
          max_tokens: opts.maxTokens ?? 1024,
        };
        if (onDelta) Object.assign(body, { stream: true, stream_options: { include_usage: true } });
        if (schema && useFormat) {
          body.response_format =
            endpoint.jsonMode === 'json_schema'
              ? { type: 'json_schema', json_schema: { name: schema.name, schema: schema.json, strict: true } }
              : { type: 'json_object' };
        }
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (endpoint.apiKey) headers.Authorization = `Bearer ${endpoint.apiKey}`;
        const signals = [AbortSignal.timeout(endpoint.timeoutMs)];
        if (signal) signals.push(signal);
        let res: Response;
        try {
          res = await fetch(`${endpoint.baseUrl}/chat/completions`, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: AbortSignal.any(signals),
          });
        } catch (err) {
          if (signal?.aborted) throw err;
          const timedOut = (err as Error).name === 'TimeoutError';
          throw new ModelError(
            timedOut ? `The model did not answer within ${Math.round(endpoint.timeoutMs / 1000)} s.` : 'Could not reach the model endpoint.',
            true,
          );
        }
        if (!res.ok) {
          const detail = (await res.text().catch(() => '')).slice(0, 240);
          if (res.status === 400 && useFormat) {
            // Older servers reject structured-output parameters; the prompt still asks for JSON.
            useFormat = false;
            throw new ModelError(`Structured output was rejected (${detail}).`, true, 0);
          }
          if (res.status === 429 || res.status >= 500) {
            const retryAfter = Number(res.headers.get('retry-after'));
            throw new ModelError(
              res.status === 429 ? 'The model endpoint is rate limiting requests.' : `The model endpoint returned ${res.status}.`,
              true,
              Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(30, retryAfter) * 1000 : undefined,
            );
          }
          throw new ModelError(`The model endpoint returned ${res.status}: ${detail}`);
        }
        if (onDelta) ({ text, usage } = await readStream(res, onDelta));
        else {
          const data = await res.json();
          text = data.choices?.[0]?.message?.content ?? '';
          usage = data.usage ?? null;
        }
      }
    } catch (err) {
      if (call) call.end = Date.now();
      if (signal?.aborted) throw err;
      lastError = err as Error;
      if (!(err instanceof ModelError) || !err.retryable || attempt === endpoint.maxRetries) throw lastError;
      await sleep(err.waitMs ?? Math.min(8000, 500 * 2 ** attempt), signal);
      continue;
    }

    if (call) {
      call.end = Date.now();
      call.promptTokens = usage?.prompt_tokens ?? estimateTokens(messages);
      call.completionTokens = usage?.completion_tokens ?? estimateTokens(text);
      call.estimated = !usage;
    }
    if (!schema) return { text, json: undefined };

    try {
      const parsed = schema.zod.safeParse(parseJson(text));
      if (parsed.success) return { text, json: parsed.data };
      throw new ModelError(`The model's answer did not match the expected structure: ${parsed.error.issues[0]?.message ?? 'invalid'}.`);
    } catch (err) {
      lastError = err as Error;
      if (jsonRetried) throw new ModelError(lastError.message);
      jsonRetried = true;
      // One corrective retry: never trust free-form output as structured data.
      messages = [...opts.messages, { role: 'assistant', content: text.slice(0, 4000) }, { role: 'user', content: 'That was not valid JSON in the required shape. Return only the JSON object, nothing else.' }];
      attempt--;
    }
  }
  throw lastError;
}
