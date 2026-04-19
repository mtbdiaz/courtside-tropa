import Header from './components/Header';
import LoginPanel from '@/components/LoginPanel';

export default function HomePage({ searchParams }: { searchParams?: { next?: string } }) {
  const nextPath = searchParams?.next ?? '/dashboard';

  return (
    <main className="min-h-screen">
      <Header />

      <section className="mx-auto grid w-full max-w-4xl gap-6 px-4 py-8 lg:px-6 lg:py-12">
        <section className="glass-panel rounded-[2rem] p-6 sm:p-8">
          <p className="text-xs uppercase tracking-[0.35em] text-amber-200/80">Admin Access</p>
          <h2 className="text-display mt-3 text-4xl font-semibold leading-tight sm:text-5xl">Sign in to manage queue and courts</h2>
          <p className="mt-4 text-sm leading-7 text-slate-200/85">Use one shared admin account for all event operators.</p>
          <div className="mt-6">
            <LoginPanel nextPath={nextPath} />
          </div>
        </section>
      </section>
    </main>
  );
}
