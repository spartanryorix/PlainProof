import { z } from 'zod';
import { fail, handler, rateLimit, readJson } from '@/lib/server/http';
import { config } from '@/lib/server/config';
import { synthesize } from '@/lib/server/tts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ text: z.string().trim().min(1).max(1200), voice: z.string().max(60).optional(), speed: z.number().min(0.5).max(2).default(1) });

export const POST = handler(async (req: Request) => {
  if (!config.tts.baseUrl) return fail('No neural voice service is configured. The browser voice is used instead.', 501);
  const limited = rateLimit(req, 'tts', 240);
  if (limited) return limited;
  const { text, voice, speed } = await readJson(req, Body, 20_000);
  const chosen = voice && config.tts.voices.includes(voice) ? voice : config.tts.voices[0];
  const audio = await synthesize(text, chosen, speed, req.signal);
  return new Response(audio, { headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'private, max-age=3600' } });
});
