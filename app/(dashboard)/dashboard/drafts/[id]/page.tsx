import { redirect } from 'next/navigation';

interface Props {
  params: Promise<{ id: string }>;
}

/**
 * Legacy route redirect: /dashboard/drafts/[id] → /dashboard/uploads?editDraft=[id].
 * @param props - Route params.
 */
export default async function LegacyEditDraftRedirectPage({ params }: Props) {
  const { id } = await params;
  redirect(`/dashboard/uploads?editDraft=${encodeURIComponent(id)}`);
}
