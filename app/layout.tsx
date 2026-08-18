import type { Metadata, Viewport } from 'next';
import '../src/web/styles/globals.css';

export const metadata: Metadata = {
  title: 'Opportunity Radar',
  description:
    'Where should we deploy our next unit of effort for the highest expected return?',
  applicationName: 'Opportunity Radar',
  manifest: '/manifest.webmanifest',
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
      <body>{children}</body>
    </html>
  );
}
