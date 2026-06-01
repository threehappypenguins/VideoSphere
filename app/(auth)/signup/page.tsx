import { redirect } from 'next/navigation';

/**
 * Public signup is disabled; invite-only registration is used instead.
 * @returns Never returns — redirects to login.
 */
export default function SignUpPage() {
  redirect('/login');
}
