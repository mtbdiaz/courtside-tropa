import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import Header from '@/app/components/Header';
import MatchHistoryBoard from '@/components/MatchHistoryBoard';

export default async function DashboardHistoryPage() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();

  if (!data.user) {
    redirect('/?next=/dashboard/history');
  }

  return (
    <main className="min-h-screen">
      <Header />
      <MatchHistoryBoard initialBatchId={1} />
    </main>
  );
}
