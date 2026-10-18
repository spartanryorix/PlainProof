// SQLite storage. Only extracted text is stored, never the uploaded file itself, and every
// document is deleted automatically after RETENTION_HOURS.

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import { config } from './config';
import type { VersionRecord } from '@/lib/engine/pipeline';
import type { Claim, CostSummary, Domain, Receipt, ReviewDecision, Round } from '@/lib/engine/types';
import type { LanguageCode, ProfileId, ToneId } from '@/lib/engine/profiles';

const g = globalThis as unknown as { __ppdb?: Database.Database; __pppurge?: NodeJS.Timeout };

function migrate(d: Database.Database) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      filename TEXT,
      mime TEXT,
      size_bytes INTEGER,
      source TEXT NOT NULL,
      extraction TEXT NOT NULL,
      pages INTEGER,
      text TEXT NOT NULL,
      words INTEGER NOT NULL,
      domain TEXT,
      doc_title TEXT,
      source_language TEXT,
      claims TEXT,
      settings TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS versions (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      profile TEXT NOT NULL,
      language TEXT NOT NULL,
      tone TEXT NOT NULL,
      level INTEGER NOT NULL,
      story_mode INTEGER NOT NULL DEFAULT 0,
      rounds TEXT NOT NULL,
      final_round INTEGER NOT NULL,
      receipt TEXT NOT NULL,
      cost TEXT NOT NULL,
      review TEXT NOT NULL DEFAULT '[]',
      actions_done TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (document_id, profile, language)
    );
    CREATE TABLE IF NOT EXISTS shares (
      id TEXT PRIMARY KEY,
      version_id TEXT NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS versions_doc ON versions(document_id);
  `);
}

export function db(): Database.Database {
  if (!g.__ppdb) {
    fs.mkdirSync(config.dataDir, { recursive: true });
    const d = new Database(path.join(config.dataDir, 'plainproof.db'));
    d.pragma('journal_mode = WAL');
    d.pragma('foreign_keys = ON');
    migrate(d);
    g.__ppdb = d;
    purgeExpired();
    g.__pppurge ??= setInterval(purgeExpired, 30 * 60 * 1000);
    g.__pppurge.unref?.();
  }
  return g.__ppdb;
}

export function closeDb() {
  clearInterval(g.__pppurge);
  g.__pppurge = undefined;
  g.__ppdb?.close();
  g.__ppdb = undefined;
}

export function purgeExpired() {
  if (!config.retentionHours || !g.__ppdb) return 0;
  const cutoff = new Date(Date.now() - config.retentionHours * 3600_000).toISOString();
  return g.__ppdb.prepare('DELETE FROM documents WHERE updated_at < ?').run(cutoff).changes;
}

const now = () => new Date().toISOString();
const parse = <T>(s: string | null, fallback: T): T => {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};

export interface DocumentRow {
  id: string;
  title: string;
  filename: string | null;
  mime: string | null;
  sizeBytes: number | null;
  source: 'upload' | 'paste' | 'sample';
  extraction: string;
  pages: number | null;
  text: string;
  words: number;
  domain: Domain | null;
  docTitle: string | null;
  sourceLanguage: string | null;
  claims: Claim[] | null;
  createdAt: string;
  updatedAt: string;
}

type RawDoc = Record<string, string | number | null>;

const toDoc = (r: RawDoc): DocumentRow => ({
  id: r.id as string,
  title: r.title as string,
  filename: r.filename as string | null,
  mime: r.mime as string | null,
  sizeBytes: r.size_bytes as number | null,
  source: r.source as DocumentRow['source'],
  extraction: r.extraction as string,
  pages: r.pages as number | null,
  text: r.text as string,
  words: r.words as number,
  domain: r.domain as Domain | null,
  docTitle: r.doc_title as string | null,
  sourceLanguage: r.source_language as string | null,
  claims: parse<Claim[] | null>(r.claims as string | null, null),
  createdAt: r.created_at as string,
  updatedAt: r.updated_at as string,
});

export function createDocument(d: Omit<DocumentRow, 'id' | 'createdAt' | 'updatedAt' | 'domain' | 'docTitle' | 'sourceLanguage' | 'claims'>): DocumentRow {
  const id = randomUUID();
  const t = now();
  db()
    .prepare(
      `INSERT INTO documents (id, title, filename, mime, size_bytes, source, extraction, pages, text, words, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, d.title, d.filename, d.mime, d.sizeBytes, d.source, d.extraction, d.pages, d.text, d.words, t, t);
  return getDocument(id)!;
}

export function getDocument(id: string): DocumentRow | null {
  const r = db().prepare('SELECT * FROM documents WHERE id = ?').get(id) as RawDoc | undefined;
  return r ? toDoc(r) : null;
}

export function saveClaims(id: string, claims: Claim[], domain: Domain, docTitle: string, sourceLanguage: string) {
  db()
    .prepare('UPDATE documents SET claims = ?, domain = ?, doc_title = ?, source_language = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(claims), domain, docTitle, sourceLanguage, now(), id);
}

export function renameDocument(id: string, title: string) {
  return db().prepare('UPDATE documents SET title = ?, updated_at = ? WHERE id = ?').run(title, now(), id).changes > 0;
}

export function deleteDocument(id: string) {
  return db().prepare('DELETE FROM documents WHERE id = ?').run(id).changes > 0;
}

export function deleteAllDocuments() {
  return db().prepare('DELETE FROM documents').run().changes;
}

export interface VersionRow {
  id: string;
  documentId: string;
  profile: ProfileId;
  language: LanguageCode;
  tone: ToneId;
  level: number;
  storyMode: boolean;
  rounds: Round[];
  finalRound: number;
  receipt: Receipt;
  cost: CostSummary;
  review: ReviewDecision[];
  actionsDone: string[];
  createdAt: string;
  updatedAt: string;
}

const toVersion = (r: RawDoc): VersionRow => ({
  id: r.id as string,
  documentId: r.document_id as string,
  profile: r.profile as ProfileId,
  language: r.language as LanguageCode,
  tone: r.tone as ToneId,
  level: r.level as number,
  storyMode: Boolean(r.story_mode),
  rounds: parse<Round[]>(r.rounds as string, []),
  finalRound: r.final_round as number,
  receipt: parse<Receipt>(r.receipt as string, {} as Receipt),
  cost: parse<CostSummary>(r.cost as string, {} as CostSummary),
  review: parse<ReviewDecision[]>(r.review as string, []),
  actionsDone: parse<string[]>(r.actions_done as string, []),
  createdAt: r.created_at as string,
  updatedAt: r.updated_at as string,
});

// A new run for the same audience and language replaces the previous version.
export function saveVersion(documentId: string, v: VersionRecord) {
  const t = now();
  const d = db();
  d.transaction(() => {
    d.prepare('DELETE FROM versions WHERE document_id = ? AND profile = ? AND language = ?').run(documentId, v.profile, v.language);
    d.prepare(
      `INSERT INTO versions (id, document_id, profile, language, tone, level, story_mode, rounds, final_round, receipt, cost, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(v.versionId, documentId, v.profile, v.language, v.tone, v.level, v.storyMode ? 1 : 0, JSON.stringify(v.rounds), v.finalRound, JSON.stringify(v.receipt), JSON.stringify(v.cost), t, t);
    d.prepare('UPDATE documents SET updated_at = ? WHERE id = ?').run(t, documentId);
  })();
}

export function getVersion(id: string): VersionRow | null {
  const r = db().prepare('SELECT * FROM versions WHERE id = ?').get(id) as RawDoc | undefined;
  return r ? toVersion(r) : null;
}

export function listVersions(documentId: string): VersionRow[] {
  return (db().prepare('SELECT * FROM versions WHERE document_id = ? ORDER BY created_at').all(documentId) as RawDoc[]).map(toVersion);
}

export function updateVersion(id: string, patch: { review?: ReviewDecision[]; actionsDone?: string[]; rounds?: Round[]; finalRound?: number; receipt?: Receipt }) {
  const sets: string[] = [];
  const args: (string | number)[] = [];
  if (patch.review) sets.push('review = ?') && args.push(JSON.stringify(patch.review));
  if (patch.actionsDone) sets.push('actions_done = ?') && args.push(JSON.stringify(patch.actionsDone));
  if (patch.rounds) sets.push('rounds = ?') && args.push(JSON.stringify(patch.rounds));
  if (patch.finalRound !== undefined) sets.push('final_round = ?') && args.push(patch.finalRound);
  if (patch.receipt) sets.push('receipt = ?') && args.push(JSON.stringify(patch.receipt));
  if (!sets.length) return false;
  const t = now();
  const ok = db().prepare(`UPDATE versions SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).run(...args, t, id).changes > 0;
  if (ok) db().prepare('UPDATE documents SET updated_at = ? WHERE id = (SELECT document_id FROM versions WHERE id = ?)').run(t, id);
  return ok;
}

export interface LibraryItem {
  id: string;
  title: string;
  filename: string | null;
  source: string;
  extraction: string;
  words: number;
  domain: string | null;
  createdAt: string;
  updatedAt: string;
  versions: { id: string; profile: ProfileId; language: LanguageCode; outcome: string; semantic: boolean }[];
}

export function listDocuments(q = ''): LibraryItem[] {
  const like = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`;
  const docs = db()
    .prepare(
      `SELECT id, title, filename, source, extraction, words, domain, created_at, updated_at FROM documents
       WHERE ? = '' OR title LIKE ? ESCAPE '\\' OR filename LIKE ? ESCAPE '\\' OR doc_title LIKE ? ESCAPE '\\'
       ORDER BY updated_at DESC LIMIT 200`,
    )
    .all(q, like, like, like) as RawDoc[];
  const versions = db().prepare('SELECT id, document_id, profile, language, receipt FROM versions').all() as RawDoc[];
  const byDoc = new Map<string, LibraryItem['versions']>();
  for (const v of versions) {
    const receipt = parse<Receipt | null>(v.receipt as string, null);
    const list = byDoc.get(v.document_id as string) ?? [];
    list.push({ id: v.id as string, profile: v.profile as ProfileId, language: v.language as LanguageCode, outcome: receipt?.verification.outcome ?? 'issues', semantic: Boolean(receipt?.verification.semantic) });
    byDoc.set(v.document_id as string, list);
  }
  return docs.map((d) => ({
    id: d.id as string,
    title: d.title as string,
    filename: d.filename as string | null,
    source: d.source as string,
    extraction: d.extraction as string,
    words: d.words as number,
    domain: d.domain as string | null,
    createdAt: d.created_at as string,
    updatedAt: d.updated_at as string,
    versions: byDoc.get(d.id as string) ?? [],
  }));
}

export function createShare(versionId: string) {
  const id = randomBytes(9).toString('base64url');
  db().prepare('INSERT INTO shares (id, version_id, created_at) VALUES (?, ?, ?)').run(id, versionId, now());
  return id;
}

export function getShare(id: string) {
  if (!/^[A-Za-z0-9_-]{8,32}$/.test(id)) return null;
  const r = db().prepare('SELECT version_id FROM shares WHERE id = ?').get(id) as { version_id: string } | undefined;
  if (!r) return null;
  const version = getVersion(r.version_id);
  if (!version) return null;
  const document = getDocument(version.documentId);
  return document ? { version, document } : null;
}
