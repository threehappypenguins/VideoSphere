import { redirectToFirstRunSetupIfNeeded } from '@/lib/auth/first-run-setup';

/**
 * Sends first-run visitors to setup instead of the login form.
 * @param props - Layout props.
 * @returns The login page subtree.
 */
export default async function LoginLayout({ children }: { children: React.ReactNode }) {
  await redirectToFirstRunSetupIfNeeded();
  return children;
}
