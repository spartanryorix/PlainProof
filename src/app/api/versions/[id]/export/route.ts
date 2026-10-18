import { fail, handler } from '@/lib/server/http';
import { finalReceipt, getDocumentOr404 } from '@/lib/server/service';
import { packageHtml, plainText } from '@/lib/server/exports';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'explanation';

export const GET = handler(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { version, receipt } = finalReceipt((await params).id);
  const doc = getDocumentOr404(version.documentId);
  const name = `${slug(doc.title)}-${version.profile}-${version.language}`;
  const format = new URL(req.url).searchParams.get('format') ?? 'html';
  if (format === 'txt') {
    return new Response(plainText(doc, version), {
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}.txt"`, 'Cache-Control': 'no-store' },
    });
  }
  if (format === 'html') {
    return new Response(packageHtml(doc, version, receipt), {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}.html"`, 'Cache-Control': 'no-store' },
    });
  }
  return fail('Use format=txt or html.', 400);
});
