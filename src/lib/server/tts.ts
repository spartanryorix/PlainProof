// Neural text-to-speech through any OpenAI-compatible /audio/speech endpoint (for example
// Kokoro-FastAPI served next to vLLM). Without one, the browser's own voices are used and the
// interface says so.

import { config } from './config';

export async function synthesize(text: string, voice: string, speed: number, signal?: AbortSignal): Promise<ArrayBuffer> {
  if (!config.tts.baseUrl) throw Object.assign(new Error('No neural voice service is configured.'), { status: 501 });
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.tts.apiKey) headers.Authorization = `Bearer ${config.tts.apiKey}`;
  const res = await fetch(`${config.tts.baseUrl}/audio/speech`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model: config.tts.model, input: text, voice, speed, response_format: 'mp3' }),
    signal: AbortSignal.any([AbortSignal.timeout(30_000), ...(signal ? [signal] : [])]),
  });
  if (!res.ok) throw Object.assign(new Error(`The voice service returned ${res.status}.`), { status: 502 });
  return res.arrayBuffer();
}
