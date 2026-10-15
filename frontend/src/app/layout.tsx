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
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: '48x48' },
      { url: '/bee-mark.svg', type: 'image/svg+xml' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180' }],
  },
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
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
      </head>
      <body className="min-h-screen bg-[var(--surface)] text-[var(--text)] font-sans safe-area-bottom">
        <PWAProvider>{children}</PWAProvider>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function () {
                if (!('serviceWorker' in navigator)) return;
                var w = window;
                var inTauri = !!(w.__TAURI_INTERNALS__ || w.__TAURI_METADATA__ || w.__TAURI__);
                if (inTauri) {
                  // Desktop app serves assets from its embedded bundle; a service
                  // worker cache only ever replays stale bundles after an update.
                  // Actively self-heal already-registered workers from old builds.
                  try {
                    navigator.serviceWorker.getRegistrations().then(function (regs) {
                      regs.forEach(function (r) { r.unregister(); });
                    }).catch(function () {});
                    if (w.caches && w.caches.keys) {
                      w.caches.keys().then(function (keys) {
                        keys.forEach(function (k) { w.caches.delete(k); });
                      }).catch(function () {});
                    }
                  } catch (e) {}
                  return;
                }
                window.addEventListener('load', function () {
                  navigator.serviceWorker.register('/sw.js').catch(function () {});
                });
              })();
            `,
          }}
        />
      </body>
    </html>
  );
}