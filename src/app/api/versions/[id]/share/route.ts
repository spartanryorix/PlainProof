import { handler, json, rateLimit } from '@/lib/server/http';
import { getVersionOr404 } from '@/lib/server/service';
import { createShare } from '@/lib/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = handler(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const limited = rateLimit(req, 'share', 30);
  if (limited) return limited;
  const v = getVersionOr404((await params).id);
  const id = createShare(v.id);
  return json({ id, url: `/s/${id}` }, 201);
});
