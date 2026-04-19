import Header from '../components/Header';
import CourtsideBoard from '@/components/CourtsideBoard';

export default function QueuePage({ searchParams }: { searchParams: { batch?: string } }) {
  const batch = searchParams.batch === '2' ? 2 : 1;

  return (
    <main className="min-h-screen">
      <Header />
      <CourtsideBoard publicView initialBatchId={batch} />
    </main>
  );
}
