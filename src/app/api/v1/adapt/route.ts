import { z } from 'zod';
import { handler, json, rateLimit, readJson } from '@/lib/server/http';
import { adaptOnce, RunSchema } from '@/lib/server/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 600;

const Body = RunSchema.extend({ text: z.string().min(1).max(200_000) });

// The whole pipeline as one REST call, for embedding in another system. Nothing is stored.
export const POST = handler(async (req: Request) => {
  const limited = rateLimit(req, 'run', 12);
  if (limited) return limited;
  const { text, ...run } = await readJson(req, Body, 400_000);
  return json(await adaptOnce(text, run));
});
