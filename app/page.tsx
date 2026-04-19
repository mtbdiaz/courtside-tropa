import Header from './components/Header';
import LoginPanel from '@/components/LoginPanel';
import Link from 'next/link';
import { CalendarDays, MapPinned, Waves } from 'lucide-react';

export default function HomePage({ searchParams }: { searchParams?: { next?: string } }) {
  const nextPath = searchParams?.next ?? '/dashboard';

  return (
    <main className="min-h-screen">
      <Header />

      <section className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-8 lg:grid-cols-[1fr_1fr] lg:px-6 lg:py-12">
        <section className="glass-panel rounded-[2rem] p-6 sm:p-8">
          <p className="text-xs uppercase tracking-[0.35em] text-amber-200/80">Admin Access</p>
          <h2 className="text-display mt-3 text-4xl font-semibold leading-tight sm:text-5xl">Sign in to manage queue and courts</h2>
          <p className="mt-4 text-sm leading-7 text-slate-200/85">Use one shared admin account for all event operators.</p>
          <div className="mt-6">
            <LoginPanel nextPath={nextPath} />
          </div>
        </section>

        <section className="glass-panel rounded-[2rem] p-6 sm:p-8">
          <p className="text-xs uppercase tracking-[0.35em] text-amber-200/80">Public Queue Access</p>
          <h2 className="text-display mt-3 text-4xl font-semibold leading-tight sm:text-5xl">View-only live queue</h2>
          <p className="mt-4 text-sm leading-7 text-slate-200/85">Players can track queue order, current matches, and leaderboard without login.</p>

          <div className="mt-6 space-y-3 text-sm text-slate-200/90">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center gap-2 text-amber-200"><CalendarDays className="h-4 w-4" /> May 1, 2026</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center gap-2 text-rose-200"><MapPinned className="h-4 w-4" /> Paddle Up! Davao (Buhangin)</div>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/queue?batch=1" className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-slate-100/90 transition hover:bg-white/10">
              <Waves className="h-4 w-4 text-amber-200" />
              Open Batch 1 Queue
            </Link>
            <Link href="/queue?batch=2" className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-slate-100/90 transition hover:bg-white/10">
              <Waves className="h-4 w-4 text-amber-200" />
              Open Batch 2 Queue
            </Link>
          </div>
        </section>
      </section>
    </main>
  );
}
