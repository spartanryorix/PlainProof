import { Suspense } from 'react';
import { Studio } from '@/components/studio/Studio';

export const metadata = { title: 'Document Studio' };

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={null}>
      <Studio id={id} />
    </Suspense>
  );
}
