import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/inter';
import '@fontsource-variable/plus-jakarta-sans';
import '@fontsource-variable/noto-sans-arabic';
import '@fontsource-variable/noto-sans-tamil';
import '@fontsource-variable/lexend';
import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/700.css';
import { Providers, themeScript } from '@/components/providers';
import './globals.css';

// Fonts are self-hosted from npm packages, so the app works offline and makes no third-party requests.

export const metadata: Metadata = {
  title: { default: 'PlainProof · Understanding, with receipts', template: '%s · PlainProof' },
  description: 'Turn complex documents into clear, personalized explanations, with evidence you can inspect.',
  icons: { icon: '/icon.svg' },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f7f7f5' },
    { media: '(prefers-color-scheme: dark)', color: '#0f1013' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[200] focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2 focus:shadow-pop">
          Skip to content
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
