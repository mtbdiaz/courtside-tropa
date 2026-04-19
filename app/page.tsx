import Header from './components/Header';
import LoginPanel from '@/components/LoginPanel';
import Link from 'next/link';
import { ArrowRight, Waves, CalendarDays, Sparkles } from 'lucide-react';

export default function HomePage({ searchParams }: { searchParams?: { next?: string } }) {
  const nextPath = searchParams?.next ?? '/dashboard';

  return (
    <main className="min-h-screen">
      <Header />

      <section className="mx-auto grid w-full max-w-7xl gap-8 px-4 py-8 lg:grid-cols-[1.1fr_0.9fr] lg:px-6 lg:py-12">
        <div className="space-y-6">
          <div className="glass-panel rounded-[2rem] p-6 sm:p-8">
            <p className="text-xs uppercase tracking-[0.35em] text-amber-200/80">Sunset theme realtime system</p>
            <h2 className="text-display mt-3 text-4xl font-semibold leading-tight sm:text-5xl">
              Queue faster, match cleaner, and keep every court synced.
            </h2>
            <p className="mt-4 max-w-2xl text-base leading-7 text-slate-200/85">
              Courtside Tropa is built for a one-day pickleball event with live queueing, batch switching, court timers, score entry, and shared admin access across devices.
            </p>

            <div className="mt-6 flex flex-wrap gap-3 text-sm text-slate-100/90">
              <Badge icon={<CalendarDays className="h-4 w-4" />} text="Batch 1: 8 AM - 12 NN" />
              <Badge icon={<CalendarDays className="h-4 w-4" />} text="Batch 2: 1 PM - 5 PM" />
              <Badge icon={<Sparkles className="h-4 w-4" />} text="80-100 players per batch" />
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/queue?batch=1" className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-slate-100/90 transition hover:bg-white/10">
                <Waves className="h-4 w-4 text-amber-200" />
                View public queue
              </Link>
              <Link href="/dashboard" className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-orange-500 via-pink-500 to-purple-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-orange-950/30">
                Open dashboard
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <FeatureCard title="Realtime" copy="Supabase auth, database sync, and broadcast-friendly updates across admin and public devices." />
            <FeatureCard title="Courts" copy="Five or six active courts with live timers and automatic queue assignment as matches end." />
            <FeatureCard title="Flow" copy="Pair players, pause breaks, finalize scores, and send the next players back into play." />
          </div>
        </div>

        <div className="space-y-6">
          <section className="glass-panel rounded-[2rem] p-6 sm:p-8">
            <div className="mb-6 flex items-center justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.35em] text-amber-200/70">Admin access</p>
                <h3 className="mt-2 text-2xl font-semibold text-white">Sign in</h3>
              </div>
              <div className="rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-xs text-amber-100">Shared login</div>
            </div>
            <LoginPanel nextPath={nextPath} />
          </section>

          <section className="glass-panel rounded-[2rem] p-6 sm:p-8">
            <div className="flex items-center gap-3 text-amber-200">
              <Sparkles className="h-5 w-5" />
              <h3 className="text-lg font-semibold text-white">Event details</h3>
            </div>
            <div className="mt-4 grid gap-3 text-sm text-slate-200/85 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="text-xs uppercase tracking-[0.25em] text-slate-400/80">Venue</div>
                <div className="mt-2 font-medium text-white">Paddle Up! Davao (Buhangin)</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="text-xs uppercase tracking-[0.25em] text-slate-400/80">Theme</div>
                <div className="mt-2 font-medium text-white">Deep indigo with sunset gradients</div>
              </div>
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}

function Badge({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2">
      <span className="text-amber-200">{icon}</span>
      <span>{text}</span>
    </div>
  );
}

function FeatureCard({ title, copy }: { title: string; copy: string }) {
  return (
    <div className="glass-panel rounded-[1.75rem] p-5">
      <h4 className="text-lg font-semibold text-white">{title}</h4>
      <p className="mt-2 text-sm leading-6 text-slate-300/80">{copy}</p>
    </div>
  );
}
