import type { Metadata } from 'next';
import Link from 'next/link';
import UploadVideoForm from '@/components/UploadVideoForm';

export const metadata: Metadata = {
  title: 'Upload Video',
  description: 'Upload a video file for this draft.',
};

interface Props {
  params: Promise<{ id: string }>;
}

export default async function DraftUploadPage({ params }: Props) {
  const { id } = await params;
  const backHref = `/dashboard/drafts/${id}`;

  return (
    <div className="px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-2xl space-y-6">
        <header>
          <h1 className="text-3xl font-semibold tracking-tight">Upload Video</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Upload your video file. Supported formats: MP4, MOV, AVI, MKV, WebM. Maximum size: 5 GB.
          </p>
        </header>

        <UploadVideoForm draftId={id} backHref={backHref} />

        <Link href={backHref} className="block text-sm font-medium text-primary hover:underline">
          ← Back to draft
        </Link>
      </div>
    </div>
  );
}
