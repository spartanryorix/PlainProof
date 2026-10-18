// Document intake: validate by content (magic bytes), never by extension alone, then extract
// text with a real parser. A failed extraction is reported, never papered over.

import path from 'node:path';
import fs from 'node:fs';
import { config } from './config';

export type FileKind = 'pdf' | 'docx' | 'txt' | 'image';

export class IntakeError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export interface Extraction {
  text: string;
  method: string;
  pages: number | null;
  warnings: string[];
}

export function safeFilename(name: string): string {
  const base = path.basename(String(name || 'document')).normalize('NFKC');
  const clean = base.replace(/[^\p{L}\p{N}._ -]+/gu, '_').replace(/^\.+/, '').slice(0, 120).trim();
  return clean || 'document';
}

function isUtf8Text(buf: Buffer) {
  if (buf.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf);
    return true;
  } catch {
    return false;
  }
}

export function sniff(buf: Buffer, filename: string): FileKind {
  const ext = path.extname(filename).toLowerCase();
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) {
    if (buf.includes(Buffer.from('word/document.xml')) || buf.includes(Buffer.from('word/'))) return 'docx';
    throw new IntakeError('This ZIP-based file is not a Word document (.docx).', 415);
  }
  if (buf[0] === 0x89 && buf.subarray(1, 4).toString('latin1') === 'PNG') return 'image';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image';
  if (buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0) {
    throw new IntakeError('Old Word documents (.doc) are not supported. Save it as .docx or PDF and try again.', 415);
  }
  const claimed: Record<string, string> = { '.pdf': 'a PDF', '.docx': 'a Word document', '.png': 'a PNG image', '.jpg': 'a JPEG image', '.jpeg': 'a JPEG image', '.webp': 'a WebP image' };
  if (claimed[ext]) throw new IntakeError(`This file is named like ${claimed[ext]}, but its contents are not. It may be damaged or renamed.`, 415);
  if (['.txt', '.md', '.text', ''].includes(ext) && isUtf8Text(buf)) return 'txt';
  if (isUtf8Text(buf) && !/\.(exe|dll|js|html?|svg|xml|zip)$/i.test(ext)) return 'txt';
  throw new IntakeError('This file type is not supported. Upload a PDF, Word (.docx), text file, or a PNG, JPEG or WebP image.', 415);
}

// Clean extracted text: line endings, control characters, PDF hard wraps, excess blank lines.
export function normalizeText(raw: string): string {
  return raw
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/([^\n.:!?;])\n(?=[\p{Ll}(])/gu, '$1 ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

let tesseractLock: Promise<unknown> = Promise.resolve();

async function ocrImage(image: Buffer): Promise<string> {
  // One OCR job at a time: Tesseract is CPU-heavy, and the queue keeps the server responsive.
  const job = tesseractLock.then(async () => {
    const { createWorker } = await import('tesseract.js');
    const cachePath = path.join(config.dataDir, 'tessdata');
    fs.mkdirSync(cachePath, { recursive: true });
    const worker = await createWorker(config.ocr.langs, 1, { cachePath });
    try {
      const { data } = await worker.recognize(image);
      return data.text ?? '';
    } finally {
      await worker.terminate();
    }
  });
  tesseractLock = job.catch(() => undefined);
  return job;
}

async function ocrWithModel(image: Buffer, mime: string): Promise<string | null> {
  if (!config.vision || config.preview) return null;
  const { transcribeImage } = await import('@/lib/engine/agents');
  const { Meter } = await import('@/lib/engine/llm');
  const { engineDeps } = await import('./config');
  const deps = await engineDeps();
  return transcribeImage(`data:${mime};base64,${image.toString('base64')}`, { endpoint: deps.endpoint, meter: new Meter(deps.gpuHourlyUsd, false) });
}

async function readImage(buf: Buffer): Promise<Extraction> {
  const mime = buf[0] === 0x89 ? 'image/png' : buf[0] === 0xff ? 'image/jpeg' : 'image/webp';
  const viaModel = await ocrWithModel(buf, mime).catch(() => null);
  if (viaModel) return { text: viaModel, method: 'Image, read by the AI model (vision OCR)', pages: 1, warnings: ['Text was read from an image and may contain recognition errors.'] };
  const text = await ocrImage(buf);
  return { text, method: 'Image, read with OCR (Tesseract)', pages: 1, warnings: ['Text was read from an image with OCR and may contain recognition errors.'] };
}

async function readPdf(buf: Buffer): Promise<Extraction> {
  const { getDocumentProxy, extractText, renderPageAsImage } = await import('unpdf');
  let pages: string[];
  let total: number;
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const result = await extractText(pdf, { mergePages: false });
    pages = result.text as string[];
    total = result.totalPages;
  } catch (err) {
    const msg = String((err as Error)?.message ?? err);
    if (/password/i.test(msg)) throw new IntakeError('This PDF is password-protected. Remove the password and upload it again.');
    throw new IntakeError('This PDF could not be read. It may be damaged.');
  }
  const text = pages.join('\n\n');
  const perPage = text.replace(/\s/g, '').length / Math.max(1, total);
  if (perPage >= 40) return { text, method: 'PDF text layer', pages: total, warnings: [] };

  // Little or no text layer: a scanned PDF. Render pages and run OCR.
  const limit = Math.min(total, config.ocr.maxPages);
  const out: string[] = [];
  for (let n = 1; n <= limit; n++) {
    const png = await renderPageAsImage(new Uint8Array(buf), n, { canvasImport: () => import('@napi-rs/canvas'), scale: 2 });
    out.push(await ocrImage(Buffer.from(png as ArrayBuffer)));
  }
  const warnings = ['This PDF has no text layer, so its pages were read with OCR. Recognition errors are possible.'];
  if (total > limit) warnings.push(`Only the first ${limit} of ${total} pages were read.`);
  return { text: out.join('\n\n'), method: 'Scanned PDF, read with OCR (Tesseract)', pages: total, warnings };
}

async function readDocx(buf: Buffer): Promise<Extraction> {
  const mammoth = (await import('mammoth')).default;
  try {
    const { value, messages } = await mammoth.extractRawText({ buffer: buf });
    const warnings = messages.some((m) => m.type === 'error') ? ['Parts of this Word document could not be read.'] : [];
    return { text: value, method: 'Word document (.docx)', pages: null, warnings };
  } catch {
    throw new IntakeError('This Word document could not be read. It may be damaged.');
  }
}

export async function extractDocument(buf: Buffer, filename: string): Promise<Extraction & { kind: FileKind }> {
  if (!buf.length) throw new IntakeError('The file is empty.');
  if (buf.length > config.limits.maxUploadBytes) {
    throw new IntakeError(`The file is larger than ${Math.round(config.limits.maxUploadBytes / 1024 / 1024)} MB.`, 413);
  }
  const kind = sniff(buf, filename);
  const result =
    kind === 'pdf' ? await readPdf(buf) : kind === 'docx' ? await readDocx(buf) : kind === 'image' ? await readImage(buf) : { text: buf.toString('utf8'), method: 'Text file', pages: null, warnings: [] };
  const text = normalizeText(result.text);
  validateText(text);
  return { ...result, text, kind };
}

export function validateText(text: string) {
  if (text.replace(/\s/g, '').length < config.limits.minChars) {
    throw new IntakeError('No readable text was found in this document. If it is a scan or photo, make sure the text is sharp and upright.', 422);
  }
  if (text.length > config.limits.maxChars) {
    throw new IntakeError(`This document is too long (${text.length.toLocaleString('en')} characters; the limit is ${config.limits.maxChars.toLocaleString('en')}). Split it into parts and upload each part.`, 413);
  }
}
