// app/layout.tsx
import type { Metadata, Viewport } from 'next';
import { Cormorant_Garamond, Space_Grotesk } from 'next/font/google';
import './globals.css';

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-space-grotesk',
  display: 'swap',
});

const cormorant = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-cormorant',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL('https://courtside-tropa.vercel.app'),
  title: {
    default: 'Courtside Tropa',
    template: '%s | Courtside Tropa',
  },
  description: 'One-day pickleball queueing and matchmaking for Paddle Up! Davao.',
  applicationName: 'Courtside Tropa',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: '/favicon.ico',
  },
};

export const viewport: Viewport = {
  themeColor: '#1e1b4b',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${spaceGrotesk.variable} ${cormorant.variable}`}>
      <body className="min-h-screen bg-midnight text-slate-50 antialiased">
        {children}
      </body>
    </html>
  );
}