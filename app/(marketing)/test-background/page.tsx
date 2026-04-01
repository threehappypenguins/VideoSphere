import type { Metadata } from 'next';
import { GaussianNoiseBackground } from '@/components/ui/GaussianNoiseBackground';

export const metadata: Metadata = {
  title: 'Background Test',
  robots: { index: false, follow: false },
};

export default function TestBackgroundPage() {
  return (
    <>
      <GaussianNoiseBackground />

      {/* Sample content so you can see how elements sit on top of the noise bg */}
      <main className="relative flex min-h-screen flex-col items-center justify-center gap-8 px-6 text-center font-sans">
        <h1 className="text-4xl font-bold tracking-tight text-foreground">Background Test Page</h1>
        <p className="max-w-lg text-muted-foreground">
          This page previews the Gaussian noise background before it is applied app-wide. Switch
          between light and dark mode to see both variants.
        </p>

        {/* Card to check text readability against the grain */}
        <div className="rounded-xl border border-border bg-background/60 px-8 py-6 shadow-md backdrop-blur-sm">
          <p className="text-sm text-muted-foreground">
            Body text on a semi-transparent card — verify legibility here.
          </p>
        </div>

        <p className="text-xs text-muted-foreground/50">
          Route: /test-background — not indexed by search engines.
        </p>
      </main>
    </>
  );
}
