import { redirect } from 'next/navigation';

interface Props {
  params: Promise<{ id: string }>;
}

/**
 * Legacy route redirect: /dashboard/drafts/[id]/upload → /dashboard/videos/[id]/upload.
 * @param props - Route params.
 */
export default async function LegacyDraftUploadRedirectPage({ params }: Props) {
  const { id } = await params;
  redirect(`/dashboard/videos/${encodeURIComponent(id)}/upload`);
}
