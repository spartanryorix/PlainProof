import { z } from 'zod';
import { handler, json, readJson } from '@/lib/server/http';
import { getDocumentOr404 } from '@/lib/server/service';
import { deleteDocument, listVersions, renameDocument } from '@/lib/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const document = getDocumentOr404(id);
  return json({ document, versions: listVersions(id) });
});

export const PATCH = handler(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  getDocumentOr404(id);
  const { title } = await readJson(req, z.object({ title: z.string().trim().min(1).max(120) }));
  renameDocument(id, title);
  return json({ document: getDocumentOr404(id) });
});

export const DELETE = handler(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  getDocumentOr404(id);
  deleteDocument(id);
  return json({ deleted: true });
});
