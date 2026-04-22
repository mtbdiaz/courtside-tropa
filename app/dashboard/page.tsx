import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isScorerEmail } from '@/lib/auth-role';
import Header from '../components/Header';
import CourtsideBoard from '@/components/CourtsideBoard';

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();

  if (!data.user) {
    redirect('/?next=/dashboard');
  }

  if (isScorerEmail(data.user.email)) {
    redirect('/dashboard/score');
  }

  return (
    <main className="min-h-screen">
      <Header />
      <CourtsideBoard initialBatchId={1} />
    </main>
  );
}
