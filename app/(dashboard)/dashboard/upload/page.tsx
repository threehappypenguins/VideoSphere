import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Upload Video | VideoSphere',
  description: 'Static placeholder for the upcoming video upload experience.',
};

export default function UploadVideoPage() {
  return (
    <main className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Upload Video</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Prepare your content for publishing. The full upload workflow is coming soon.
        </p>
      </header>

      <section className="rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 p-10 text-center">
        <p className="text-lg font-medium">Drag and drop upload area</p>
        <p className="mt-2 text-sm text-gray-600">Supported formats: MP4, MOV, AVI, WebM</p>
        <p className="text-sm text-gray-600">Maximum file size: up to 2 GB per video</p>
        <p className="mt-4 text-sm font-medium text-gray-700">
          Coming soon: upload progress, validation, and publish settings.
        </p>
      </section>

      <Link href="/dashboard" className="text-sm font-medium text-blue-600 hover:underline">
        Back to Dashboard
      </Link>
    </main>
  );
}
