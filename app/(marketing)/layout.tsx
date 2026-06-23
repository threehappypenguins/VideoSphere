import Navbar from '@/components/layout/Navbar';
import Footer from '@/components/layout/Footer';
import { isFirstRunSetupPending } from '@/lib/auth/first-run-setup';
import { getSessionUserFromCookies } from '@/lib/auth/get-current-user-id-from-cookies';

/** Session and first-run checks hit MongoDB; skip static prerender (e.g. Docker image build). */
export const dynamic = 'force-dynamic';

/**
 * Renders the marketing layout component.
 * @param props - Component props.
 * @returns The rendered UI output.
 */
export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const sessionUser = await getSessionUserFromCookies();
  const firstRunPending = await isFirstRunSetupPending();

  return (
    <>
      <Navbar initialSessionUser={sessionUser} initialFirstRunPending={firstRunPending} />
      <main className="flex min-h-[calc(100vh-4rem)] flex-col">{children}</main>
      <Footer />
    </>
  );
}
