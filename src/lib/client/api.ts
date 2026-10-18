'use client';

import type { DocumentRow, LibraryItem, VersionRow } from '@/lib/server/db';
import type { StreamEvent } from '@/lib/server/service';
import type { RunRequest } from '@/lib/engine/types';

export type { DocumentRow, LibraryItem, VersionRow, StreamEvent };

export interface Health {
  mode: 'model' | 'preview';
  writerModel: string;
  verifierModel: string;
  endpoint: string;
  hardware: string;
  semantic: boolean;
  vision: boolean;
  tts: { available: boolean; label?: string; voices?: string[]; languages?: string[] };
  ocr: { langs: string };
  limits: { maxUploadMb: number; maxChars: number; maxRepairs: number };
  retentionHours: number;
  gpuHourlyUsd: number;
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function api<T>(url: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } });
  } catch {
    throw new ApiError('Could not reach PlainProof. Check your connection and try again.', 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? `The request failed (${res.status}).`, res.status);
  return data as T;
}

export interface UploadResult {
  document: DocumentRow;
  warnings: string[];
  suggested?: { tone: RunRequest['tone']; protectedTerms: string[] };
}

// XMLHttpRequest, because fetch cannot report upload progress.
export function uploadFile(file: File, onProgress: (fraction: number) => void, signal?: AbortSignal): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/documents');
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let data: { error?: string } & Partial<UploadResult> = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* non-JSON error page */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as UploadResult);
      else reject(new ApiError(data.error ?? `The upload failed (${xhr.status}).`, xhr.status));
    };
    xhr.onerror = () => reject(new ApiError('The upload was interrupted. Check your connection and try again.', 0));
    signal?.addEventListener('abort', () => xhr.abort());
    const form = new FormData();
    form.append('file', file);
    xhr.send(form);
  });
}

export async function* streamRun(documentId: string, body: RunRequest, signal: AbortSignal): AsyncGenerator<StreamEvent> {
  const res = await fetch(`/api/documents/${documentId}/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(data.error ?? `The run could not start (${res.status}).`, res.status);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      if (chunk.startsWith('data: ')) yield JSON.parse(chunk.slice(6)) as StreamEvent;
    }
  }
}

export function download(url: string) {
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  a.download = '';
  document.body.append(a);
  a.click();
  a.remove();
}

export const formatBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

export const timeAgo = (iso: string) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};
