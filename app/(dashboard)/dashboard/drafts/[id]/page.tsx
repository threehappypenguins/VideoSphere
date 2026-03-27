import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Edit Draft',
  description: 'Open the draft metadata modal for this draft.',
};

interface Props {
  params: Promise<{ id: string }>;
}

export default async function EditDraftPage({ params }: Props) {
  const { id } = await params;
  redirect(`/dashboard/drafts?editDraft=${encodeURIComponent(id)}`);
}
