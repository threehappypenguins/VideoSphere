import Navbar from '@/components/layout/Navbar';
import Footer from '@/components/layout/Footer';
import { getNavbarAuthStateFromCookies } from '@/lib/auth/get-current-user-id-from-cookies';

export default async function DashboardTemplate({ children }: { children: React.ReactNode }) {
  const { sessionUser, hasAdminRole } = await getNavbarAuthStateFromCookies();

  return (
    <>
      <Navbar initialSessionUser={sessionUser} initialHasAdminRole={hasAdminRole} />
      <main className="flex min-h-[calc(100vh-4rem)] flex-col">{children}</main>
      <Footer />
    </>
  );
}
