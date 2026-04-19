import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import Header from '../components/Header';
import CourtsideBoard from '@/components/CourtsideBoard';

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();

  if (!data.user) {
    redirect('/?next=/dashboard');
  }

  return (
    <main className="min-h-screen">
      <Header />
      <CourtsideBoard initialBatchId={1} />
    </main>
  );
}
