import Link from 'next/link';

export default function NotFound() {
  return (
    <main id="main" className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <p className="text-sm font-semibold uppercase tracking-[0.14em] text-accent">404</p>
      <h1 className="mt-3 font-display text-3xl font-bold tracking-tight">This page does not exist</h1>
      <p className="mt-2 max-w-sm text-text-2">The link may be wrong, or the document may have been deleted.</p>
      <Link href="/" className="mt-6 rounded-xl bg-accent px-5 py-2.5 text-sm font-medium text-accent-fg hover:bg-accent-hover">
        Go to PlainProof
      </Link>
    </main>
  );
}
