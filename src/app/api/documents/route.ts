import { z } from 'zod';
import { fail, handler, json, rateLimit, readJson } from '@/lib/server/http';
import { createFromSample, createFromText, createFromUpload } from '@/lib/server/service';
import { deleteAllDocuments, listDocuments } from '@/lib/server/db';
import { config } from '@/lib/server/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TextBody = z.union([
  z.object({ text: z.string().min(1).max(200_000), title: z.string().max(120).optional() }),
  z.object({ sample: z.string().max(40) }),
]);

export const GET = handler(async (req: Request) => {
  const q = new URL(req.url).searchParams.get('q')?.slice(0, 100) ?? '';
  return json({ documents: listDocuments(q) });
});

export const POST = handler(async (req: Request) => {
  const limited = rateLimit(req, 'upload', 20);
  if (limited) return limited;
  const type = req.headers.get('content-type') ?? '';
  if (type.startsWith('multipart/form-data')) {
    const len = Number(req.headers.get('content-length') ?? 0);
    if (len > config.limits.maxUploadBytes + 64 * 1024) {
      return fail(`The file is larger than ${Math.round(config.limits.maxUploadBytes / 1024 / 1024)} MB.`, 413);
    }
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return fail('Choose a file to upload.', 400);
    return json(await createFromUpload(file), 201);
  }
  const body = await readJson(req, TextBody, 400_000);
  return json('sample' in body ? createFromSample(body.sample) : createFromText(body.text, body.title), 201);
});

// Deleting everything needs an explicit confirmation header, so it cannot happen by accident.
export const DELETE = handler(async (req: Request) => {
  if (req.headers.get('x-confirm') !== 'delete-all') return fail('Confirmation required.', 400);
  return json({ deleted: deleteAllDocuments() });
});
