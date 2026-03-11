// =============================================================================
// EDIT DRAFT PAGE
// =============================================================================
// Static UI shell for /dashboard/drafts/[id].
//
// STUDENT: This form is intentionally uncontrolled and not yet wired to any
// API. The route and UI are established so the backend can wire load/save later.
//
// What you need to do:
//   1. On mount, call GET /api/drafts/[id] and pre-populate each field
//   2. On "Save Draft", call PUT /api/drafts/[id] with the form values
//   3. Show a success/error toast after save
//   4. Protect this route so only authenticated users can access it
//
// See /docs/api-routes.md for the drafts API contract.
// =============================================================================

import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Edit Draft',
  description: 'Edit your video draft metadata before publishing.',
};

const INPUT_CLASS =
  'mt-2 block w-full rounded-lg border border-border bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

const LABEL_CLASS = 'block text-sm font-medium text-foreground';

const PLATFORMS = ['YouTube', 'Vimeo'] as const;

const VISIBILITY_OPTIONS = [
  { value: 'public', label: 'Public' },
  { value: 'unlisted', label: 'Unlisted' },
  { value: 'private', label: 'Private' },
  { value: 'scheduled', label: 'Scheduled' },
] as const;

interface Props {
  params: { id: string };
}

export default async function EditDraftPage({ params }: Props) {
  const { id } = params;

  return (
    <div className="px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl">
        {/* --- Header --- */}
        <header>
          <h1 className="text-3xl font-bold text-foreground">Edit Draft</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Draft ID: <span className="font-mono text-foreground">{id}</span>
          </p>
        </header>

        <form>
          {/* --- Metadata --- */}
          <section className="mt-8 rounded-xl border border-border bg-background p-6">
            <h2 className="text-xl font-semibold text-foreground">Metadata</h2>

            <div className="mt-6 space-y-6">
              {/* Title */}
              <div>
                <label htmlFor="draft-title" className={LABEL_CLASS}>
                  Title
                </label>
                <input
                  type="text"
                  id="draft-title"
                  name="title"
                  defaultValue=""
                  placeholder="Enter a title for your video"
                  className={INPUT_CLASS}
                  required
                />
              </div>

              {/* Description */}
              <div>
                <label htmlFor="draft-description" className={LABEL_CLASS}>
                  Description
                </label>
                <textarea
                  id="draft-description"
                  name="description"
                  rows={4}
                  defaultValue=""
                  placeholder="Describe your video"
                  className={INPUT_CLASS}
                />
              </div>

              {/* Tags */}
              <div>
                <label htmlFor="draft-tags" className={LABEL_CLASS}>
                  Tags
                </label>
                <input
                  type="text"
                  id="draft-tags"
                  name="tags"
                  defaultValue=""
                  placeholder="e.g. travel, vlog, tips"
                  className={INPUT_CLASS}
                />
                <p className="mt-1.5 text-xs text-muted-foreground">Separate tags with commas.</p>
              </div>
            </div>
          </section>

          {/* --- Distribution --- */}
          <section className="mt-8 rounded-xl border border-border bg-background p-6">
            <h2 className="text-xl font-semibold text-foreground">Distribution</h2>

            {/* Target Platforms */}
            <div className="mt-6">
              <p className={LABEL_CLASS}>Target Platforms</p>
              <div className="mt-3 space-y-3">
                {PLATFORMS.map((platform) => (
                  <label
                    key={platform}
                    className="flex cursor-pointer items-center gap-3 text-sm text-foreground"
                  >
                    <input
                      type="checkbox"
                      name="platforms"
                      value={platform.toLowerCase()}
                      defaultChecked={false}
                      className="h-4 w-4 rounded border-border accent-primary"
                    />
                    {platform}
                  </label>
                ))}
              </div>
            </div>

            {/* Visibility */}
            <div className="mt-6">
              <label htmlFor="draft-visibility" className={LABEL_CLASS}>
                Visibility
              </label>
              <select
                id="draft-visibility"
                name="visibility"
                defaultValue="public"
                className={INPUT_CLASS}
              >
                {VISIBILITY_OPTIONS.map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </section>

          {/* --- Actions --- */}
          <div className="mt-8 flex items-center gap-4">
            <button
              type="submit"
              className="rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Save draft
            </button>
            <Link
              href="/dashboard/drafts"
              className="rounded-lg border border-border px-6 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
