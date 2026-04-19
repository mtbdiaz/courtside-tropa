import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import Header from '@/app/components/Header';
import CourtsideBoard from '@/components/CourtsideBoard';

export default async function DashboardScorePage() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();

  if (!data.user) {
    redirect('/?next=/dashboard/score');
  }

  return (
    <main className="min-h-screen">
      <Header />
      <CourtsideBoard mode="score" initialBatchId={1} />
    </main>
  );
}
