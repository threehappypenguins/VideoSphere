// =============================================================================
// ROOT LAYOUT
// =============================================================================
// This is the root layout that wraps every page in your application.
// It includes the global font, navbar, and footer.
//
// STUDENT: Update the metadata below with your actual app name and description.
// Fonts are self-hosted under app/fonts/ via next/font/local (no Google Fonts at build time).
//
// =============================================================================

import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import { ThemeProvider } from 'next-themes';
import { Toaster } from '@/components/ui/sonner';
import { OnboardingProvider } from '@/components/onboarding/OnboardingContext';
import { OnboardingTourGate } from '@/components/onboarding/OnboardingTourGate';
import { ThemedBackground } from '@/components/ui/ThemedBackground';

// --- Font Configuration ---
// next/font/local inlines font files at build time — no runtime CDN requests.
const inter = localFont({
  src: [{ path: './fonts/InterVariable.woff2', weight: '100 900', style: 'normal' }],
  variable: '--font-inter',
  display: 'swap',
});

const apfelGrotezk = localFont({
  src: [
    { path: './fonts/ApfelGrotezk-Brukt.otf', weight: '350', style: 'normal' },
    { path: './fonts/ApfelGrotezk-Regular.otf', weight: '400', style: 'normal' },
    { path: './fonts/ApfelGrotezk-Mittel.otf', weight: '500', style: 'normal' },
    { path: './fonts/ApfelGrotezk-Fett.otf', weight: '700', style: 'normal' },
    { path: './fonts/ApfelGrotezk-Satt.otf', weight: '900', style: 'normal' },
  ],
  variable: '--font-apfel-grotezk',
  display: 'swap',
});

// --- Metadata ---
// STUDENT: Replace these placeholder values with your actual app information.
// See /docs/performance.md for more on metadata and SEO.
/**
 * Provides static page metadata for this route segment.
 */
export const metadata: Metadata = {
  title: {
    default: 'VideoSphere',
    template: '%s | VideoSphere',
  },
  description:
    'Upload once, distribute everywhere. VideoSphere lets creators distribute videos to YouTube, Vimeo, and more from a single dashboard.',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: '48x48' },
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon-96x96.png', sizes: '96x96', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
  },
  manifest: '/site.webmanifest',
};

/**
 * Renders the root layout component.
 * @param props - Component props.
 * @returns The rendered UI output.
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${apfelGrotezk.variable} ${inter.variable}`}
      suppressHydrationWarning
    >
      <head></head>
      <body className="font-sans antialiased" suppressHydrationWarning>
        <ThemeProvider attribute="class" defaultTheme="system">
          <OnboardingProvider>
            <ThemedBackground />
            {children}
            <OnboardingTourGate />
            <Toaster />
          </OnboardingProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
