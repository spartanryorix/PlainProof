import { handler, json, readJson } from '@/lib/server/http';
import { getVersionOr404, ReviewSchema, updateReview } from '@/lib/server/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (_req: Request, { params }: Ctx) => json({ version: getVersionOr404((await params).id) }));

export const PATCH = handler(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const patch = await readJson(req, ReviewSchema, 400_000);
  return json({ version: updateReview(id, patch) });
});
