import Navbar from '@/components/layout/Navbar';
import Footer from '@/components/layout/Footer';
import { getSessionUserFromCookies } from '@/lib/auth/get-current-user-id-from-cookies';

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const sessionUser = await getSessionUserFromCookies();

  return (
    <>
      <Navbar initialSessionUser={sessionUser} />
      <main className="flex min-h-[calc(100vh-4rem)] flex-col">{children}</main>
      <Footer />
    </>
  );
}
