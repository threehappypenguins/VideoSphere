import Navbar from '@/components/layout/Navbar';
import Footer from '@/components/layout/Footer';
import DashboardShell from '@/components/dashboard/DashboardShell';
import { getNavbarAuthStateFromCookies } from '@/lib/auth/get-current-user-id-from-cookies';

/**
 * Renders the dashboard template component.
 * @param props - Component props.
 * @returns The rendered UI output.
 */
export default async function DashboardTemplate({ children }: { children: React.ReactNode }) {
  const { sessionUser, hasAdminRole } = await getNavbarAuthStateFromCookies();

  return (
    <>
      <Navbar initialSessionUser={sessionUser} initialHasAdminRole={hasAdminRole} />
      <main className="flex flex-col">
        <DashboardShell>{children}</DashboardShell>
      </main>
      <Footer />
    </>
  );
}
