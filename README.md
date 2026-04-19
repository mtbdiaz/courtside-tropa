# Courtside Tropa

Realtime pickleball queueing and matchmaking for the one-day Courtside Tropa event.

## Setup

1. Add your Supabase environment variables to `.env.local`.
2. Run the schema in [supabase/schema.sql](supabase/schema.sql).
3. Start the app with `npm run dev`.

## Routes

- `/` admin login and event landing page
- `/dashboard` protected admin dashboard
- `/queue?batch=1` or `/queue?batch=2` public live queue view

## Notes

- The app reads and writes normalized tables: `events`, `batches`, `players`, `courts`, `matches`, `match_history`.
- Queue order is inferred from player `created_at` while excluding players currently in active matches.
- Public queue updates through Supabase realtime subscriptions on `batches`, `players`, `courts`, `matches`, and `match_history`.
