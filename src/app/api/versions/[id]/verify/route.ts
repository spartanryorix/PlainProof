import { z } from 'zod';
import { handler, json, rateLimit, readJson } from '@/lib/server/http';
import { verifyEdit } from '@/lib/server/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export const POST = handler(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const limited = rateLimit(req, 'run', 12);
  if (limited) return limited;
  const { adapted } = await readJson(req, z.object({ adapted: z.string().min(1).max(60_000) }), 200_000);
  return json({ version: await verifyEdit((await params).id, adapted) });
});
