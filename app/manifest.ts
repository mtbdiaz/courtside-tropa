import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Courtside Tropa',
    short_name: 'Courtside',
    description: 'Realtime pickleball queueing for the Courtside Tropa one-day event.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#0a0920',
    theme_color: '#1e1b4b',
    icons: [
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
      },
    ],
  };
}
