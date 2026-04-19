'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { ArrowRight, Lock, Mail, ShieldCheck } from 'lucide-react';

export default function LoginPanel({ nextPath = '/dashboard' }: { nextPath?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        router.replace(nextPath);
      }
    });
  }, [nextPath, router]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');

    const supabase = createSupabaseBrowserClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      setError(signInError.message);
      return;
    }

    startTransition(() => {
      router.replace(nextPath);
      router.refresh();
    });
  };

  return (
    <div className="mx-auto w-full max-w-xl rounded-[1.25rem] border border-white/10 bg-white/5 p-5 sm:p-6">
      <div className="mb-6 flex items-center gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-200/90">
        <ShieldCheck className="h-5 w-5 text-amber-300" />
        Shared admin access for event operators.
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="mb-2 block text-sm font-medium text-orange-100/90">Email</label>
          <div className="relative">
            <Mail className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-amber-300" />
            <input
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="Entrer Admin Email"
              className="glass-input w-full rounded-2xl px-12 py-4 text-sm outline-none transition"
            />
          </div>
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-orange-100/90">Password</label>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-amber-300" />
            <input
              type="password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
              className="glass-input w-full rounded-2xl px-12 py-4 text-sm outline-none transition"
            />
          </div>
        </div>

        {error ? <p className="rounded-2xl border border-rose-300/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{error}</p> : null}

        <button
          type="submit"
          disabled={isPending}
          className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-orange-500 via-pink-500 to-purple-600 px-5 py-4 text-sm font-semibold text-white shadow-lg shadow-orange-950/30 transition hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isPending ? 'Signing in...' : 'Enter Dashboard'}
          <ArrowRight className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
