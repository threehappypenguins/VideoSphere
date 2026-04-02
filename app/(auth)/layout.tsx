import Navbar from '@/components/layout/Navbar';
import Footer from '@/components/layout/Footer';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Navbar />
      <main className="flex min-h-[calc(100vh-4rem)] flex-col">{children}</main>
      <Footer />
    </>
  );
}
