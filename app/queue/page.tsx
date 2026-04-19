import Header from '../components/Header';
import CourtsideBoard from '@/components/CourtsideBoard';
import Link from 'next/link';

export default async function QueuePage({
  searchParams,
}: {
  searchParams: Promise<{ batch?: string }>;
}) {
  const params = await searchParams;
  const rawBatch = params.batch;
  const batch = rawBatch === '1' || rawBatch === '2' ? (Number(rawBatch) as 1 | 2) : null;

  if (!batch) {
    return (
      <main className="min-h-screen">
        <Header />
        <section className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6 lg:py-12">
          <article className="glass-panel rounded-[2rem] p-6 sm:p-8">
            <p className="text-xs uppercase tracking-[0.35em] text-amber-200/80">Live Queue</p>
            <h2 className="text-display mt-3 text-4xl font-semibold leading-tight sm:text-5xl">Choose Batch</h2>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <Link href="/queue?batch=1" className="rounded-2xl border border-white/10 bg-white/5 px-5 py-4 text-center text-sm font-medium text-slate-100/90 transition hover:bg-white/10">
                Batch 1
              </Link>
              <Link href="/queue?batch=2" className="rounded-2xl border border-white/10 bg-white/5 px-5 py-4 text-center text-sm font-medium text-slate-100/90 transition hover:bg-white/10">
                Batch 2
              </Link>
            </div>
          </article>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen">
      <Header />
      <CourtsideBoard mode="public" initialBatchId={batch} />
    </main>
  );
}
