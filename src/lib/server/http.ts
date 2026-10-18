import { NextResponse } from 'next/server';
import { z, ZodError } from 'zod';

export const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store', ...headers } });

export const fail = (message: string, status = 400, extra: Record<string, unknown> = {}) => json({ error: message, ...extra }, status);

export function clientKey(req: Request) {
  const fwd = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return fwd || req.headers.get('x-real-ip') || 'local';
}

// In-memory token buckets per client and route group. Enough for a single-node deployment.
const buckets = new Map<string, { tokens: number; at: number }>();

export function rateLimit(req: Request, group: string, perMinute: number): Response | null {
  const key = `${group}:${clientKey(req)}`;
  const t = Date.now();
  const b = buckets.get(key) ?? { tokens: perMinute, at: t };
  b.tokens = Math.min(perMinute, b.tokens + ((t - b.at) / 60_000) * perMinute);
  b.at = t;
  if (b.tokens < 1) {
    buckets.set(key, b);
    const wait = Math.ceil(((1 - b.tokens) / perMinute) * 60);
    return fail(`Too many requests. Try again in ${wait} seconds.`, 429, { retryAfter: wait });
  }
  b.tokens -= 1;
  buckets.set(key, b);
  if (buckets.size > 5000) for (const [k, v] of buckets) if (t - v.at > 600_000) buckets.delete(k);
  return null;
}

export async function readJson<S extends z.ZodTypeAny>(req: Request, schema: S, maxBytes = 1_000_000): Promise<z.output<S>> {
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > maxBytes) throw new HttpError('The request is too large.', 413);
  let raw: unknown;
  try {
    const text = await req.text();
    if (text.length > maxBytes) throw new HttpError('The request is too large.', 413);
    raw = text ? JSON.parse(text) : {};
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError('The request body is not valid JSON.', 400);
  }
  try {
    return schema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      const issue = err.issues[0];
      throw new HttpError(`Invalid request: ${issue.path.join('.') || 'body'} ${issue.message.toLowerCase()}.`, 400);
    }
    throw err;
  }
}

export class HttpError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

// Wrap a route handler: known errors become clean JSON, unknown ones are logged without
// request contents (documents may be sensitive) and reported generically.
export function handler<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (err) {
      const e = err as Error & { status?: number };
      if (e instanceof HttpError || (e.status && e.status < 500)) return fail(e.message, e.status ?? 400);
      console.error(`[plainproof] ${e.name}: ${e.message}`);
      return fail(/model|endpoint/i.test(e.message) ? e.message : 'Something went wrong on the server. Please try again.', 500);
    }
  };
}
