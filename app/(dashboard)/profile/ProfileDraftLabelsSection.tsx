'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { DraftLabelChip } from '@/components/drafts/DraftLabelChip';
import {
  MAX_DRAFT_LABEL_LIBRARY_SIZE,
  defaultDraftLabelColorForName,
  mergeUniqueDraftLabels,
  parseDraftLabelInput,
} from '@/lib/draft-labels';
import type { ApiResponse, DraftLabelDefinition } from '@/types';

const INPUT_CLASS =
  'mt-2 block w-full rounded-lg border border-border bg-background px-4 py-3 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

/**
 * Settings section for managing saved draft labels used in autocomplete.
 * @returns Draft labels management UI for the profile page.
 */
export function ProfileDraftLabelsSection() {
  const [library, setLibrary] = useState<DraftLabelDefinition[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const loadLibrary = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/drafts/labels', { cache: 'no-store' });
      if (!response.ok) {
        throw new Error('Failed to load draft labels');
      }
      const payload = (await response.json()) as ApiResponse<DraftLabelDefinition[]>;
      setLibrary(Array.isArray(payload.data) ? payload.data : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load draft labels.');
      setLibrary([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);

  const addLabelFromInput = () => {
    const parsed = parseDraftLabelInput(inputValue);
    if (parsed.length === 0) return;
    const mergedNames = mergeUniqueDraftLabels(
      library.map((entry) => entry.name),
      parsed
    );
    if (mergedNames.length > MAX_DRAFT_LABEL_LIBRARY_SIZE) {
      setError(`You can save at most ${MAX_DRAFT_LABEL_LIBRARY_SIZE} labels.`);
      return;
    }
    const mergedLibrary: DraftLabelDefinition[] = [...library];
    for (const name of parsed) {
      if (mergedLibrary.some((entry) => entry.name.toLowerCase() === name.toLowerCase())) {
        continue;
      }
      mergedLibrary.push({ name, color: defaultDraftLabelColorForName(name) });
    }
    setLibrary(mergedLibrary);
    setInputValue('');
    setError(null);
  };

  const updateLabelColor = (label: string, color: string) => {
    setLibrary((current) =>
      current.map((entry) => (entry.name === label ? { ...entry, color } : entry))
    );
  };

  const removeLabel = (label: string) => {
    setLibrary((current) => current.filter((existing) => existing.name !== label));
  };

  const handleSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsSaving(true);

    try {
      const response = await fetch('/api/drafts/labels', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ labels: library }),
      });
      const payload = (await response.json().catch(() => null)) as ApiResponse<
        DraftLabelDefinition[]
      > & {
        message?: string;
      };

      if (!response.ok) {
        setError(payload?.message ?? 'Failed to save draft labels.');
        return;
      }

      setLibrary(Array.isArray(payload.data) ? payload.data : library);
      toast.success('Draft labels saved.');
    } catch {
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="mt-8 rounded-xl border border-border bg-background p-6">
      <h2 className="text-xl font-semibold text-foreground">Draft labels</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Saved labels appear as suggestions when you tag drafts. Choose a color for each label.
        Deleting a label here also removes it from every draft that uses it.
      </p>

      {isLoading ? (
        <p className="mt-6 text-sm text-muted-foreground">Loading labels…</p>
      ) : (
        <form className="mt-6 space-y-4" onSubmit={handleSave}>
          <div>
            <label
              htmlFor="profile-draft-label-input"
              className="text-sm font-medium text-foreground"
            >
              Add label
            </label>
            <div className="mt-2 flex flex-wrap gap-2">
              <input
                id="profile-draft-label-input"
                value={inputValue}
                onChange={(event) => setInputValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ',') {
                    event.preventDefault();
                    addLabelFromInput();
                  }
                }}
                placeholder="Type a label and press Enter"
                className={INPUT_CLASS}
              />
              <button
                type="button"
                onClick={addLabelFromInput}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
              >
                Add
              </button>
            </div>
          </div>

          {library.length > 0 ? (
            <ul className="flex flex-wrap gap-2">
              {library.map((entry) => (
                <li key={entry.name}>
                  <DraftLabelChip
                    label={entry.name}
                    color={entry.color}
                    onColorChange={(color) => updateLabelColor(entry.name, color)}
                    onRemove={() => removeLabel(entry.name)}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No saved labels yet.</p>
          )}

          {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

          <button
            type="submit"
            disabled={isSaving}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSaving ? 'Saving…' : 'Save draft labels'}
          </button>
        </form>
      )}
    </section>
  );
}
