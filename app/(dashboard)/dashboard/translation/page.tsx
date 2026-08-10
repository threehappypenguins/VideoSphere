import { TranslationConfigClient } from '@/components/translation/TranslationConfigClient';

/**
 * Owner dashboard page for per-user live audio translation configuration.
 * @returns Translation settings page.
 */
export default function TranslationPage() {
  return (
    <div className="px-4 py-10 sm:px-6 lg:px-8">
      <TranslationConfigClient />
    </div>
  );
}
