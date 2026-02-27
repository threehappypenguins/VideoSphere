// =============================================================================
// ROOT LAYOUT
// =============================================================================
// This is the root layout that wraps every page in your application.
// It includes the global font, navbar, and footer.
//
// STUDENT: Update the metadata below with your actual app name and description.
// To change fonts, replace Inter with any Google Font from:
//   https://fonts.google.com/
//
// How to change fonts:
//   1. Import a different font from 'next/font/google'
//   2. Replace `Inter` with your chosen font
//   3. Update the CSS variable name if needed
//   4. Update globals.css to reference the new CSS variable
//
// See /docs/styling.md for detailed font configuration guidance.
// =============================================================================

import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import Navbar from '@/components/layout/Navbar';
import Footer from '@/components/layout/Footer';

// --- Font Configuration ---
// next/font automatically optimizes fonts — no external requests at runtime.
// The font is loaded at build time and served as a local asset.
const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
  display: 'swap',
});

// --- Metadata ---
// STUDENT: Replace these placeholder values with your actual app information.
// See /docs/performance.md for more on metadata and SEO.
export const metadata: Metadata = {
  title: {
    default: '[Your App Name]',
    template: '%s | [Your App Name]',
  },
  description: '[Your app description — explain what your SaaS product does]',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="font-sans antialiased">
        <Navbar />
        <main className="min-h-screen">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
