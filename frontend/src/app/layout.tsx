import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { PWAProvider } from '@/components/pwa';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export const metadata: Metadata = {
  title: 'Bee Network | Real-Time Geographic Intelligence for AI Agents',
  description: 'AI agents access fresh, location-specific web data through a decentralized observation network. Built on Nervos CKB.',
  themeColor: '#FFB800',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Bee Network',
  },
};

export const viewport: Viewport = {
  themeColor: '#FFB800',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} antialiased`}>
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#FFB800" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="Bees Network" />
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
      </head>
      <body className="min-h-screen bg-[var(--surface)] text-[var(--text)] font-sans safe-area-bottom">
        <PWAProvider>{children}</PWAProvider>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                window.addEventListener('load', () => {
                  navigator.serviceWorker.register('/sw.js').catch(() => {});
                });
              }
            `,
          }}
        />
      </body>
    </html>
  );
}