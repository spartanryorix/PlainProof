import { handler, rateLimit, readJson } from '@/lib/server/http';
import { RunSchema, runStream } from '@/lib/server/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 600;

export const POST = handler(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const limited = rateLimit(req, 'run', 12);
  if (limited) return limited;
  const { id } = await params;
  const body = await readJson(req, RunSchema);
  const stream = runStream(id, body, req.signal);
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
});
