import { json } from '@/lib/server/http';
import { publicHealth } from '@/lib/server/config';

export const dynamic = 'force-dynamic';

export function GET() {
  return json(publicHealth());
}
