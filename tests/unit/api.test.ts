// Route handlers called directly with real Request objects: intake (PDF, DOCX, TXT, OCR,
// invalid files), runs, review, receipts and exports.

import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as documents from '@/app/api/documents/route';
import * as documentById from '@/app/api/documents/[id]/route';
import * as runRoute from '@/app/api/documents/[id]/run/route';
import * as versionRoute from '@/app/api/versions/[id]/route';
import * as verifyRoute from '@/app/api/versions/[id]/verify/route';
import * as receiptRoute from '@/app/api/versions/[id]/receipt/route';
import * as exportRoute from '@/app/api/versions/[id]/export/route';
import * as shareRoute from '@/app/api/versions/[id]/share/route';
import * as adaptRoute from '@/app/api/v1/adapt/route';
import * as healthRoute from '@/app/api/health/route';
import { closeDb, getShare } from '@/lib/server/db';
import { serializeAdapted } from '@/lib/engine/adapted';
import { SAMPLES } from '@/lib/samples';

const fixtures = path.resolve(__dirname, '../fixtures');
const base = 'http://localhost';
const params = (id: string) => ({ params: Promise.resolve({ id }) });
let ip = 0;
// A fresh client address per request keeps the rate limiter out of the way, except where tested.
const req = (url: string, init: RequestInit = {}) => new Request(base + url, { ...init, headers: { 'x-forwarded-for': `10.0.0.${++ip % 250}`, ...(init.headers ?? {}) } });

async function upload(file: string, name = file, type = 'application/octet-stream') {
  const form = new FormData();
  form.append('file', new File([fs.readFileSync(path.join(fixtures, file))], name, { type }));
  const res = await documents.POST(req('/api/documents', { method: 'POST', body: form }));
  return { status: res.status, body: await res.json() };
}

const postJson = (fn: (r: Request, c?: never) => Promise<Response>, url: string, body: unknown, ctx?: unknown) =>
  (fn as (r: Request, c?: unknown) => Promise<Response>)(req(url, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }), ctx);

async function runEvents(docId: string, body: unknown) {
  const res = await postJson(runRoute.POST as never, `/api/documents/${docId}/run`, body, params(docId));
  expect(res.headers.get('content-type')).toMatch(/event-stream/);
  const text = await res.text();
  return text
    .split('\n\n')
    .filter((b) => b.startsWith('data: '))
    .map((b) => JSON.parse(b.slice(6)));
}

beforeAll(() => fs.rmSync(path.resolve(__dirname, '../.tmp'), { recursive: true, force: true }));
afterAll(() => {
  closeDb();
  fs.rmSync(path.resolve(__dirname, '../.tmp'), { recursive: true, force: true });
});

describe('intake', () => {
  it('reads a PDF with a text layer', async () => {
    const { status, body } = await upload('insurance.pdf');
    expect(status).toBe(201);
    expect(body.document.extraction).toBe('PDF text layer');
    expect(body.document.text).toContain('25 October 2026');
    expect(body.document.text).toContain('EUR 92.40');
  });

  it('reads a Word document', async () => {
    const { status, body } = await upload('insurance.docx');
    expect(status).toBe(201);
    expect(body.document.extraction).toMatch(/Word/);
    expect(body.document.text).toContain('Dental Plus');
  });

  it('reads a text file', async () => {
    const { status, body } = await upload('insurance.txt');
    expect(status).toBe(201);
    expect(body.document.words).toBeGreaterThan(200);
  });

  it('reads a photo with OCR', async () => {
    const { status, body } = await upload('insurance-scan.png');
    expect(status).toBe(201);
    expect(body.document.extraction).toMatch(/OCR/);
    expect(body.document.text).toMatch(/25 October 2026/);
    expect(body.warnings.join(' ')).toMatch(/recognition errors/);
  });

  it('reads a scanned PDF with OCR', async () => {
    const { status, body } = await upload('insurance-scan.pdf');
    expect(status).toBe(201);
    expect(body.document.extraction).toMatch(/Scanned PDF/);
    expect(body.document.text).toMatch(/premium/i);
  });

  it('rejects files that are not what they claim to be', async () => {
    expect((await upload('program.exe')).status).toBe(415);
    expect((await upload('program.exe', 'renamed.pdf')).status).toBe(415);
    expect((await upload('legacy.doc')).body.error).toMatch(/\.doc/);
    expect((await upload('fake.pdf')).status).toBe(415);
    expect((await upload('broken.pdf')).status).toBe(400);
  });

  it('rejects empty documents and oversized files with a clear message', async () => {
    expect((await upload('empty.txt')).body.error).toMatch(/empty/);
    expect((await upload('blank.txt')).status).toBe(422);
    const big = path.join(fixtures, '..', '.tmp', 'big.txt');
    fs.mkdirSync(path.dirname(big), { recursive: true });
    fs.writeFileSync(big, 'a'.repeat(16 * 1024 * 1024));
    const form = new FormData();
    form.append('file', new File([fs.readFileSync(big)], 'big.txt'));
    const res = await documents.POST(req('/api/documents', { method: 'POST', body: form }));
    expect(res.status).toBe(413);
  });

  it('rejects text that is too long instead of silently truncating it', async () => {
    const res = await postJson(documents.POST as never, '/api/documents', { text: 'word '.repeat(9000) });
    expect(res.status).toBe(413);
    expect((await res.json()).error).toMatch(/too long/);
  });

  it('cleans unsafe file names', async () => {
    const { body } = await upload('insurance.txt', '../../etc/passwd<script>.txt');
    expect(body.document.filename).not.toMatch(/[/<>]/);
  });
});

describe('runs, review and exports', () => {
  let docId = '';
  let versionId = '';

  it('creates a document from a sample and runs two audiences', async () => {
    const res = await postJson(documents.POST as never, '/api/documents', { sample: 'insurance' });
    docId = (await res.json()).document.id;
    const events = await runEvents(docId, { profiles: [{ id: 'teen' }, { id: 'senior' }], language: 'en', protectedTerms: SAMPLES[0].protectedTerms, injectFault: true });
    const finals = events.filter((e) => e.type === 'final');
    expect(finals).toHaveLength(2);
    expect(events.some((e) => e.type === 'error')).toBe(false);
    versionId = finals[0].versionId;

    const detail = await (await documentById.GET(req(`/api/documents/${docId}`), params(docId))).json();
    expect(detail.versions).toHaveLength(2);
    expect(detail.document.claims.length).toBeGreaterThan(10);
  });

  it('refuses Arabic and Tamil in Preview Mode instead of mislabelling English', async () => {
    const res = await postJson(runRoute.POST as never, `/api/documents/${docId}/run`, { profiles: [{ id: 'plain' }], language: 'ar' }, params(docId));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Arabic and Tamil need the AI model/);
  });

  it('validates run requests', async () => {
    const res = await postJson(runRoute.POST as never, `/api/documents/${docId}/run`, { profiles: [{ id: 'wizard' }] }, params(docId));
    expect(res.status).toBe(400);
  });

  it('saves review decisions and completed actions', async () => {
    const res = await (versionRoute.PATCH as (r: Request, c: unknown) => Promise<Response>)(
      req(`/api/versions/${versionId}`, { method: 'PATCH', body: JSON.stringify({ review: [{ item: 'c1', label: 'x', at: new Date().toISOString(), reviewer: 'QA' }], actionsDone: ['a0'] }), headers: { 'content-type': 'application/json' } }),
      params(versionId),
    );
    const { version } = await res.json();
    expect(version.actionsDone).toEqual(['a0']);
    expect(version.review[0].reviewer).toBe('QA');
  });

  it('exports the ProofPass receipt as JSON and PDF', async () => {
    const jsonRes = await receiptRoute.GET(req(`/api/versions/${versionId}/receipt?format=json`), params(versionId));
    const receipt = await jsonRes.json();
    expect(receipt.schema).toBe('plainproof.proofpass/2');
    expect(receipt.document.filename).toBe('northwind-policy-update.txt');
    expect(receipt.verification.statement).toMatch(/Semantic verification not performed/);
    expect(receipt.faultInjection).not.toBeNull();
    expect(receipt.humanReview.decisions).toHaveLength(1);
    expect(JSON.stringify(receipt)).not.toMatch(/accuracy|"score"/i);

    const pdfRes = await receiptRoute.GET(req(`/api/versions/${versionId}/receipt?format=pdf`), params(versionId));
    expect(pdfRes.headers.get('content-type')).toBe('application/pdf');
    const pdf = Buffer.from(await pdfRes.arrayBuffer());
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(20_000);
  });

  it('exports the explanation as text and as an accessible HTML package', async () => {
    const txt = await (await exportRoute.GET(req(`/api/versions/${versionId}/export?format=txt`), params(versionId))).text();
    expect(txt).toMatch(/What you need to do/);
    const html = await (await exportRoute.GET(req(`/api/versions/${versionId}/export?format=html`), params(versionId))).text();
    expect(html).toMatch(/<html lang="en" dir="ltr">/);
    expect(html).toMatch(/Not reviewed by a person|reviewed by a person/i);
  });

  it('verifies a reviewer edit and catches a changed amount', async () => {
    const detail = await (await documentById.GET(req(`/api/documents/${docId}`), params(docId))).json();
    const v = detail.versions.find((x: { id: string }) => x.id === versionId);
    const edited = serializeAdapted(v.rounds[v.finalRound].version).replaceAll('EUR 92.40', 'EUR 29.40');
    const res = await postJson(verifyRoute.POST as never, `/api/versions/${versionId}/verify`, { adapted: edited }, params(versionId));
    const { version } = await res.json();
    expect(version.rounds.at(-1).kind).toBe('human-edit');
    expect(version.receipt.verification.outcome).toBe('issues');
    expect(version.review).toEqual([]);
  });

  it('creates a share link', async () => {
    const res = await (shareRoute.POST as (r: Request, c: unknown) => Promise<Response>)(req(`/api/versions/${versionId}/share`, { method: 'POST' }), params(versionId));
    const { id } = await res.json();
    expect(getShare(id)?.version.id).toBe(versionId);
  });

  it('lists, searches and deletes documents', async () => {
    const all = await (await documents.GET(req('/api/documents'))).json();
    expect(all.documents.length).toBeGreaterThan(3);
    const found = await (await documents.GET(req('/api/documents?q=Insurance%20policy'))).json();
    expect(found.documents.every((d: { title: string }) => /insurance/i.test(d.title))).toBe(true);
    expect((await documentById.DELETE(req(`/api/documents/${docId}`, { method: 'DELETE' }), params(docId))).status).toBe(200);
    expect((await documentById.GET(req(`/api/documents/${docId}`), params(docId))).status).toBe(404);
    expect((await documents.DELETE(req('/api/documents', { method: 'DELETE' }))).status).toBe(400);
  });
});

describe('platform', () => {
  it('reports Preview Mode honestly', async () => {
    const health = await healthRoute.GET().json();
    expect(health.mode).toBe('preview');
    expect(health.semantic).toBe(false);
  });

  it('runs the whole pipeline in one REST call', async () => {
    const res = await postJson(adaptRoute.POST as never, '/api/v1/adapt', { text: SAMPLES[1].text, profiles: [{ id: 'plain' }] });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.versions[0].outcome).toBeDefined();
    expect(body.claims.length).toBeGreaterThan(5);
  });

  it('rate-limits a client that sends too many runs', async () => {
    const same = () => new Request(`${base}/api/v1/adapt`, { method: 'POST', body: '{}', headers: { 'x-forwarded-for': '192.0.2.77', 'content-type': 'application/json' } });
    const statuses = [];
    for (let i = 0; i < 14; i++) statuses.push((await adaptRoute.POST(same())).status);
    expect(statuses).toContain(429);
  });

  it('processes a document containing injected instructions like any other document', async () => {
    const { body } = await upload('injection.txt');
    const events = await runEvents(body.document.id, { profiles: [{ id: 'plain' }], protectedTerms: [] });
    expect(events.some((e) => e.type === 'final')).toBe(true);
    expect(events.some((e) => e.type === 'error')).toBe(false);
  });
});
