'use client';

import { useId, useState } from 'react';
import { toast } from 'sonner';
import { SermonAudioBibleReferencePicker } from '@/components/drafts/SermonAudioBibleReferencePicker';
import { SERMON_AUDIO_MAX_BIBLE_REFERENCES } from '@/lib/platforms/sermon-audio-bible-books';
import {
  addBibleReference,
  canAddBibleReference,
  parseBibleReferences,
  removeBibleReference,
  serializeBibleReferences,
  validateAndNormalizeTypedBibleReference,
} from '@/lib/platforms/sermon-audio-bible-references';
import { cn } from '@/lib/utils';

interface SermonAudioBibleReferencesFieldProps {
  /** Input element id (label `htmlFor`). */
  id: string;
  /** Current SA `bibleText` value (semicolon-separated references). */
  bibleText: string;
  /** Called when references change. */
  onBibleTextChange: (bibleText: string) => void;
  /** When true, applies invalid styling for upload validation. */
  invalid?: boolean;
  /** Additional classes for the field container. */
  className?: string;
}

/**
 * SermonAudio bible references field with tag chips, typed entry, and hierarchical browse picker.
 * @param props - Field configuration and callbacks.
 * @returns Bible references input UI.
 */
export function SermonAudioBibleReferencesField({
  id,
  bibleText,
  onBibleTextChange,
  invalid = false,
  className,
}: SermonAudioBibleReferencesFieldProps) {
  const inputId = useId();
  const references = parseBibleReferences(bibleText);
  const [inputValue, setInputValue] = useState('');
  const atMaxReferences = !canAddBibleReference(references);

  const updateReferences = (nextReferences: string[]) => {
    onBibleTextChange(serializeBibleReferences(nextReferences));
  };

  const commitInputReference = () => {
    const trimmed = inputValue.trim();
    if (!trimmed) return;

    const validated = validateAndNormalizeTypedBibleReference(trimmed);
    if (!validated.ok) {
      toast.error(`"${trimmed}" is not a valid Bible Reference`);
      return;
    }

    const nextReferences = addBibleReference(references, validated.reference);
    if (nextReferences.length === references.length) {
      setInputValue('');
      return;
    }
    updateReferences(nextReferences);
    setInputValue('');
  };

  const handlePickerSelect = (reference: string) => {
    const nextReferences = addBibleReference(references, reference);
    updateReferences(nextReferences);
  };

  return (
    <div>
      <div
        className={cn(
          className,
          'flex min-h-10 w-full flex-wrap items-center gap-2 px-2 py-2 text-left',
          invalid ? 'border-red-600 dark:border-red-500' : undefined
        )}
      >
        {references.map((reference) => (
          <span
            key={reference}
            className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-foreground"
          >
            {reference}
            <button
              type="button"
              onClick={() => updateReferences(removeBibleReference(references, reference))}
              className="text-muted-foreground hover:text-foreground"
              aria-label={`Remove ${reference} reference`}
            >
              x
            </button>
          </span>
        ))}
        {!atMaxReferences ? (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <input
              id={id}
              value={inputValue}
              onChange={(event) => setInputValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  commitInputReference();
                } else if (
                  event.key === 'Backspace' &&
                  inputValue === '' &&
                  references.length > 0
                ) {
                  event.preventDefault();
                  const lastReference = references[references.length - 1];
                  updateReferences(references.slice(0, -1));
                  setInputValue(lastReference ?? '');
                }
              }}
              onBlur={commitInputReference}
              placeholder="Type a reference and press Enter"
              aria-describedby={inputId}
              className="min-w-0 flex-1 border-0 bg-transparent px-1 py-1 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
            <SermonAudioBibleReferencePicker
              onSelectReference={handlePickerSelect}
              className="shrink-0"
            />
          </div>
        ) : null}
      </div>
      <p id={inputId} className="mt-1 text-xs text-muted-foreground">
        Optional. Up to {SERMON_AUDIO_MAX_BIBLE_REFERENCES} references. Press Enter to add typed
        references, or browse books chapter by chapter.
      </p>
    </div>
  );
}
