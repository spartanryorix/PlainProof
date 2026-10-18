import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getShare } from '@/lib/server/db';
import { withReview } from '@/lib/engine/receipt';
import { isRtl, labelsFor, outputLabelCode, PROFILES } from '@/lib/engine/profiles';
import { ShareReader } from './reader';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'A verified explanation', robots: { index: false } };

export default async function SharePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const share = getShare(id);
  if (!share) notFound();
  const { version, document } = share;
  const round = version.rounds[version.finalRound];
  const receipt = withReview(version.receipt, version.review);
  const code = outputLabelCode(version.language, document.sourceLanguage ?? '');
  return (
    <ShareReader
      version={round.version}
      results={round.results}
      inventions={round.inventions}
      labelsCode={code}
      labels={labelsFor(code)}
      rtl={isRtl(version.language, document.sourceLanguage ?? '')}
      profile={PROFILES[version.profile]}
      receipt={{
        id: receipt.receiptId,
        outcome: receipt.verification.outcome,
        matched: receipt.verification.counts.matched,
        total: receipt.verification.claimCount,
        semantic: receipt.verification.semantic,
        statement: receipt.verification.statement,
        review: receipt.humanReview.status,
        unresolved: receipt.unresolved.length,
        official: receipt.officialSourceNote,
        audience: receipt.audience.label,
        language: receipt.audience.languageLabel,
        document: document.filename ?? document.title,
      }}
      footer={
        <Link href="/" className="underline underline-offset-4">
          PlainProof
        </Link>
      }
    />
  );
}
