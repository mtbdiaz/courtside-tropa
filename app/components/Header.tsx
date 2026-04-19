import Link from 'next/link';
import { Sun, Waves, MapPinned, Clock3 } from 'lucide-react';

export default function Header() {
  return (
    <header className="relative overflow-hidden border-b border-white/10 bg-black/10">
      <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(251,146,60,0.12),rgba(251,113,133,0.08),rgba(168,85,247,0.14))]" />
      <div className="relative mx-auto flex max-w-7xl flex-col gap-5 px-4 py-5 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-4">
          <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-white/8 ring-1 ring-white/15 sun-orb">
            <Sun className="sun-glow h-9 w-9 text-yellow-300" />
            <div className="absolute inset-2 rounded-full bg-[radial-gradient(circle,rgba(250,204,21,0.35),transparent_68%)] blur-sm" />
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-orange-200/80">One-Day Pickleball Event</p>
            <h1 className="text-display text-3xl font-semibold tracking-tight sm:text-4xl">
              Courtside Tropa
            </h1>
            <p className="mt-1 text-sm text-orange-100/90 sm:text-base">Just One More Game… with Tropa 🏓🌅</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-sm text-slate-100/90">
          <div className="glass-panel flex items-center gap-2 rounded-full px-4 py-2">
            <Clock3 className="h-4 w-4 text-amber-300" />
            <span>May 1, 2026</span>
          </div>
          <div className="glass-panel flex items-center gap-2 rounded-full px-4 py-2">
            <MapPinned className="h-4 w-4 text-rose-300" />
            <span>Paddle Up! Davao • Buhangin</span>
          </div>
          <Link
            href="/queue?batch=1"
            className="glass-panel inline-flex items-center gap-2 rounded-full px-4 py-2 transition hover:border-amber-300/40 hover:bg-white/12"
          >
            <Waves className="h-4 w-4 text-amber-200" />
            Public Queue
          </Link>
        </div>
      </div>
    </header>
  );
}