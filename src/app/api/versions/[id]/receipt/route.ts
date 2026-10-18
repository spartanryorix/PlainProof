import { fail, handler, json, rateLimit } from '@/lib/server/http';
import { finalReceipt } from '@/lib/server/service';
import { htmlToPdf, receiptHtml } from '@/lib/server/exports';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handler(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { receipt } = finalReceipt((await params).id);
  const format = new URL(req.url).searchParams.get('format') ?? 'json';
  const name = receipt.receiptId;
  if (format === 'json') return json(receipt, 200, { 'Content-Disposition': `attachment; filename="${name}.json"` });
  if (format === 'html') {
    return new Response(receiptHtml(receipt), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
  }
  if (format === 'pdf') {
    const limited = rateLimit(req, 'pdf', 20);
    if (limited) return limited;
    let pdf: Buffer;
    try {
      pdf = await htmlToPdf(receiptHtml(receipt));
    } catch {
      return fail('The PDF renderer is not available on this server (run "npx playwright install chromium"). The JSON receipt is still available.', 503);
    }
    return new Response(new Uint8Array(pdf), {
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${name}.pdf"`, 'Cache-Control': 'no-store' },
    });
  }
  return fail('Use format=json, pdf or html.', 400);
});
