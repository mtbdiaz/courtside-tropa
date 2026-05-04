import Header from '@/app/components/Header';
import LeaderboardBoard from '@/components/LeaderboardBoard';

export const metadata = { title: 'Leaderboard' };

export default function LeaderboardPage() {
  return (
    <div className="min-h-screen">
      <Header />
      <LeaderboardBoard />
    </div>
  );
}
