import { redirect } from 'next/navigation';

interface Props {
  params: Promise<{ id: string }>;
}

/**
 * Legacy route redirect: /dashboard/drafts/[id]/upload → /dashboard/uploads/[id]/upload.
 * @param props - Route params.
 */
export default async function LegacyDraftUploadRedirectPage({ params }: Props) {
  const { id } = await params;
  redirect(`/dashboard/uploads/${encodeURIComponent(id)}/upload`);
}
