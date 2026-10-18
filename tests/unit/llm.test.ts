// The real HTTP path of the model client, against a local OpenAI-compatible mock server.

import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { chat, Meter, type Endpoint } from '@/lib/engine/llm';
import { dateKeys } from '@/lib/engine/text';

type Handler = (body: Record<string, unknown>, req: http.IncomingMessage, res: http.ServerResponse) => void;
let handler: Handler = () => {};
const seen: { body: Record<string, unknown>; auth?: string }[] = [];
let server: http.Server;
let endpoint: Endpoint;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      const body = data ? JSON.parse(data) : {};
      seen.push({ body, auth: req.headers.authorization });
      handler(body, req, res);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as { port: number };
  endpoint = { kind: 'http', baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: 'secret-key', model: 'test-model', jsonMode: 'json_schema', timeoutMs: 2000, maxRetries: 2 };
});

afterAll(() => server.close());

const reply = (res: http.ServerResponse, content: string, status = 200) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 11, completion_tokens: 7 } }));
};
const Schema = { zod: z.object({ ok: z.boolean() }), json: { type: 'object' }, name: 'test' };

describe('model client over HTTP', () => {
  it('sends the key and structured-output request, and meters usage', async () => {
    seen.length = 0;
    handler = (_b, _r, res) => reply(res, '{"ok": true}');
    const meter = new Meter(1.99, false);
    const { json } = await chat({ agent: 'verifier', messages: [{ role: 'user', content: 'hi' }], schema: Schema, endpoint, meter });
    expect(json).toEqual({ ok: true });
    expect(seen[0].auth).toBe('Bearer secret-key');
    expect((seen[0].body.response_format as { type: string }).type).toBe('json_schema');
    expect(meter.summary().totalTokens).toBe(18);
  });

  it('falls back to plain JSON prompting when structured output is rejected', async () => {
    seen.length = 0;
    handler = (b, _r, res) => (b.response_format ? reply(res, 'unsupported', 400) : reply(res, '```json\n{"ok": true}\n```'));
    const { json } = await chat({ agent: 'verifier', messages: [{ role: 'user', content: 'hi' }], schema: Schema, endpoint });
    expect(json).toEqual({ ok: true });
    expect(seen).toHaveLength(2);
    expect(seen[1].body.response_format).toBeUndefined();
  });

  it('retries after rate limiting, honouring Retry-After', async () => {
    seen.length = 0;
    let n = 0;
    handler = (_b, _r, res) => {
      if (n++ === 0) {
        res.writeHead(429, { 'Retry-After': '1' });
        return res.end('slow down');
      }
      reply(res, '{"ok": true}');
    };
    const t = Date.now();
    const { json } = await chat({ agent: 'verifier', messages: [{ role: 'user', content: 'hi' }], schema: Schema, endpoint });
    expect(json).toEqual({ ok: true });
    expect(Date.now() - t).toBeGreaterThanOrEqual(900);
  });

  it('asks once more when the answer is not valid structured data, then gives up', async () => {
    seen.length = 0;
    handler = (_b, _r, res) => reply(res, 'I think it is fine!');
    await expect(chat({ agent: 'verifier', messages: [{ role: 'user', content: 'hi' }], schema: Schema, endpoint })).rejects.toThrow(/valid JSON|expected structure/);
    expect(seen).toHaveLength(2);
  });

  it('streams deltas and reads usage from the final chunk', async () => {
    handler = (_b, _r, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      for (const piece of ['TITLE: A', '\nOVERVIEW:', '\nHello']) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 5, completion_tokens: 3 } })}\n\n`);
      res.end('data: [DONE]\n\n');
    };
    const deltas: string[] = [];
    const meter = new Meter(1.99, false);
    const { text } = await chat({ agent: 'writer', messages: [{ role: 'user', content: 'hi' }], onDelta: (d) => deltas.push(d), endpoint, meter });
    expect(text).toBe('TITLE: A\nOVERVIEW:\nHello');
    expect(deltas).toHaveLength(3);
    expect(meter.summary().totalTokens).toBe(8);
  });

  it('times out instead of hanging', async () => {
    handler = () => {};
    await expect(chat({ agent: 'writer', messages: [{ role: 'user', content: 'hi' }], endpoint: { ...endpoint, timeoutMs: 300, maxRetries: 0 } })).rejects.toThrow(/did not answer/);
  });
});

describe('dates', () => {
  it('compares dates in different formats and notices a changed month', () => {
    expect([...dateKeys('Pay by 25 October 2026')]).toEqual(['25-10-2026']);
    expect([...dateKeys('Pay by October 25, 2026')]).toEqual(['25-10-2026']);
    expect(dateKeys('25 November 2026').has('25-10-2026')).toBe(false);
  });
});
