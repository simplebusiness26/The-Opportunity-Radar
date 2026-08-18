import type { Metadata, Viewport } from 'next';
import '../src/web/styles/globals.css';
import { ServiceWorkerRegistration } from '../src/web/components/service-worker-registration';

export const metadata: Metadata = {
  title: 'Opportunity Radar',
  description:
    'Where should we deploy our next unit of effort for the highest expected return?',
  applicationName: 'Opportunity Radar',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Radar', statusBarStyle: 'black-translucent' },
  icons: { icon: '/icon.svg', apple: '/icon.svg' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#12161d',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
