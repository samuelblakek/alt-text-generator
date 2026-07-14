import type { Metadata } from 'next';
import { Space_Grotesk, Inter, Instrument_Serif } from 'next/font/google';
import './globals.css';

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['300', '500', '600'],
  variable: '--font-heading',
});

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-body',
});

const instrumentSerif = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  style: 'italic',
  variable: '--font-serif',
});

export const metadata: Metadata = {
  title: 'Alt Text Generator',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${spaceGrotesk.variable} ${inter.variable} ${instrumentSerif.variable}`}>
      <body className="bg-background font-body text-text-primary">
        <header className="sticky top-4 z-10 mx-auto mb-8 w-fit rounded-full border border-border-light bg-white/90 px-5 py-2.5 shadow-capsule backdrop-blur">
          <a href="/" className="font-heading text-sm font-medium tracking-tight text-brand-primary">
            Alt Text Generator
          </a>
        </header>
        {children}
      </body>
    </html>
  );
}
