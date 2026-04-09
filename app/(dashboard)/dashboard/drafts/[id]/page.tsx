import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

/**
 * Provides static page metadata for this route segment.
 */
export const metadata: Metadata = {
  title: 'Edit Draft',
  description: 'Open the draft metadata modal for this draft.',
};

interface Props {
  params: Promise<{ id: string }>;
}

/**
 * Renders the edit draft page component.
 * @param props - Component props.
 * @returns The rendered UI output.
 */
export default async function EditDraftPage({ params }: Props) {
  const { id } = await params;
  redirect(`/dashboard/drafts?editDraft=${encodeURIComponent(id)}`);
}
