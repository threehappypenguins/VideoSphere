'use client';

import { useState, type WheelEvent } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import {
  SERMON_AUDIO_BIBLE_BOOKS,
  type SermonAudioBibleBook,
} from '@/lib/platforms/sermon-audio-bible-books';
import {
  formatChapterRangeReference,
  formatChapterRangeEndingVerseReference,
  formatChapterReference,
  formatSingleVerseReference,
  formatVerseRangeReference,
  getChapterVerseCount,
} from '@/lib/platforms/sermon-audio-bible-references';
import { cn } from '@/lib/utils';

/** Navigation state for the hierarchical bible reference picker. */
type BiblePickerView =
  | { kind: 'books' }
  | { kind: 'chapters'; book: SermonAudioBibleBook }
  | { kind: 'chapter-mode'; book: SermonAudioBibleBook; chapter: number }
  | { kind: 'confirm-verse'; book: SermonAudioBibleBook; chapter: number; verse: number }
  | {
      kind: 'range-pick-end-chapter';
      book: SermonAudioBibleBook;
      chapterStart: number;
      verseStart: number;
    }
  | {
      kind: 'range-pick-end-verse';
      book: SermonAudioBibleBook;
      chapterStart: number;
      verseStart: number;
      chapterEnd: number;
    }
  | { kind: 'confirm-chapter'; book: SermonAudioBibleBook; chapter: number }
  | { kind: 'range-pick-chapter-end'; book: SermonAudioBibleBook; chapterStart: number }
  | {
      kind: 'range-pick-chapter-range-end';
      book: SermonAudioBibleBook;
      chapterStart: number;
      chapterEnd: number;
    };

interface SermonAudioBibleReferencePickerProps {
  /** Called when the user confirms a formatted reference string. */
  onSelectReference: (reference: string) => void;
  /** Additional classes for the browse trigger button. */
  className?: string;
  /** When true, the browse trigger is disabled. */
  disabled?: boolean;
}

/**
 * Routes wheel events to a scroll container inside a modal dialog.
 * @param event - Wheel event from the picker list container.
 */
function handleListWheel(event: WheelEvent<HTMLDivElement>) {
  event.stopPropagation();
  event.preventDefault();
  event.currentTarget.scrollTop += event.deltaY;
}

/**
 * Returns the picker header label for the current navigation view.
 * @param view - Current picker view.
 * @returns Header text shown above the list.
 */
function getPickerTitle(view: BiblePickerView): string {
  switch (view.kind) {
    case 'books':
      return 'Select Book';
    case 'chapters':
      return view.book.displayName;
    case 'chapter-mode':
      return `${view.book.displayName} ${view.chapter}`;
    case 'confirm-verse':
      return `${view.book.displayName} ${view.chapter}:${view.verse}`;
    case 'range-pick-end-chapter':
      return `${view.book.displayName} ${view.chapterStart}:${view.verseStart}-`;
    case 'range-pick-end-verse':
      return `${view.book.displayName} ${view.chapterStart}:${view.verseStart}-`;
    case 'confirm-chapter':
      return `${view.book.displayName} ${view.chapter}`;
    case 'range-pick-chapter-end':
      return `${view.book.displayName} ${view.chapterStart}-`;
    case 'range-pick-chapter-range-end':
      return `${view.book.displayName} ${view.chapterStart}-${view.chapterEnd}:`;
    default:
      return 'Select Book';
  }
}

/**
 * Returns the previous picker view for the back control.
 * @param view - Current picker view.
 * @returns Parent view, or the same view when already at the root.
 */
function getPreviousPickerView(view: BiblePickerView): BiblePickerView {
  switch (view.kind) {
    case 'books':
      return view;
    case 'chapters':
      return { kind: 'books' };
    case 'chapter-mode':
      return { kind: 'chapters', book: view.book };
    case 'confirm-verse':
      return { kind: 'chapter-mode', book: view.book, chapter: view.chapter };
    case 'range-pick-end-chapter':
      return {
        kind: 'confirm-verse',
        book: view.book,
        chapter: view.chapterStart,
        verse: view.verseStart,
      };
    case 'range-pick-end-verse':
      return {
        kind: 'range-pick-end-chapter',
        book: view.book,
        chapterStart: view.chapterStart,
        verseStart: view.verseStart,
      };
    case 'confirm-chapter':
      return { kind: 'chapter-mode', book: view.book, chapter: view.chapter };
    case 'range-pick-chapter-end':
      return { kind: 'confirm-chapter', book: view.book, chapter: view.chapterStart };
    case 'range-pick-chapter-range-end':
      return {
        kind: 'range-pick-chapter-end',
        book: view.book,
        chapterStart: view.chapterStart,
      };
    default:
      return { kind: 'books' };
  }
}

interface PickerListRowProps {
  /** Row label text. */
  label: string;
  /** Called when the row is activated. */
  onClick: () => void;
  /** When true, shows a trailing chevron. */
  showChevron?: boolean;
  /** When true, uses muted styling. */
  muted?: boolean;
}

/**
 * Single row in the bible reference picker list.
 * @param props - Row label and click handler.
 * @returns Picker list row button.
 */
function PickerListRow({ label, onClick, showChevron = true, muted = false }: PickerListRowProps) {
  return (
    <button
      type="button"
      className={cn(
        'flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground',
        muted && 'text-muted-foreground'
      )}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      <span className="truncate">{label}</span>
      {showChevron ? <ChevronRight className="h-4 w-4 shrink-0 opacity-50" /> : null}
    </button>
  );
}

/**
 * Hierarchical SermonAudio bible reference picker (book → chapter → verse/range).
 * @param props - Selection callback and trigger styling.
 * @returns Browse trigger with popover picker.
 */
export function SermonAudioBibleReferencePicker({
  onSelectReference,
  className,
  disabled = false,
}: SermonAudioBibleReferencePickerProps) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<BiblePickerView>({ kind: 'books' });

  const resetPicker = () => {
    setView({ kind: 'books' });
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      resetPicker();
    }
    setOpen(nextOpen);
  };

  const completeSelection = (reference: string) => {
    onSelectReference(reference);
    setOpen(false);
    resetPicker();
  };

  const renderPickerBody = () => {
    switch (view.kind) {
      case 'books':
        return SERMON_AUDIO_BIBLE_BOOKS.map((book) => (
          <PickerListRow
            key={book.displayName}
            label={book.displayName}
            onClick={() => setView({ kind: 'chapters', book })}
          />
        ));
      case 'chapters':
        return Array.from({ length: view.book.chapters.length }, (_, index) => {
          const chapter = index + 1;
          return (
            <PickerListRow
              key={chapter}
              label={`Chapter ${chapter}`}
              onClick={() => setView({ kind: 'chapter-mode', book: view.book, chapter })}
            />
          );
        });
      case 'chapter-mode':
        return (
          <>
            <PickerListRow
              label="Entire Chapter"
              onClick={() =>
                setView({ kind: 'confirm-chapter', book: view.book, chapter: view.chapter })
              }
            />
            {Array.from({ length: getChapterVerseCount(view.book, view.chapter) }, (_, index) => {
              const verse = index + 1;
              return (
                <PickerListRow
                  key={verse}
                  label={`Verse ${verse}`}
                  onClick={() =>
                    setView({
                      kind: 'confirm-verse',
                      book: view.book,
                      chapter: view.chapter,
                      verse,
                    })
                  }
                />
              );
            })}
          </>
        );
      case 'confirm-verse': {
        const reference = formatSingleVerseReference(
          view.book.displayName,
          view.chapter,
          view.verse
        );
        return (
          <>
            <PickerListRow
              label={`Use ${reference}`}
              showChevron={false}
              onClick={() => completeSelection(reference)}
            />
            <PickerListRow
              label="Add Range"
              onClick={() =>
                setView({
                  kind: 'range-pick-end-chapter',
                  book: view.book,
                  chapterStart: view.chapter,
                  verseStart: view.verse,
                })
              }
            />
          </>
        );
      }
      case 'range-pick-end-chapter':
        return Array.from({ length: view.book.chapters.length }, (_, index) => {
          const chapter = index + 1;
          if (chapter < view.chapterStart) return null;
          return (
            <PickerListRow
              key={chapter}
              label={`Chapter ${chapter}`}
              onClick={() =>
                setView({
                  kind: 'range-pick-end-verse',
                  book: view.book,
                  chapterStart: view.chapterStart,
                  verseStart: view.verseStart,
                  chapterEnd: chapter,
                })
              }
            />
          );
        });
      case 'range-pick-end-verse': {
        const endVerseCount = getChapterVerseCount(view.book, view.chapterEnd);
        return (
          <>
            <PickerListRow
              label="Entire Chapter"
              onClick={() => {
                const reference = formatVerseRangeReference(
                  view.book.displayName,
                  view.chapterStart,
                  view.verseStart,
                  view.chapterEnd,
                  endVerseCount
                );
                completeSelection(reference);
              }}
            />
            {Array.from({ length: endVerseCount }, (_, index) => {
              const verse = index + 1;
              if (view.chapterEnd === view.chapterStart && verse < view.verseStart) {
                return null;
              }
              return (
                <PickerListRow
                  key={verse}
                  label={`Verse ${verse}`}
                  onClick={() => {
                    const reference = formatVerseRangeReference(
                      view.book.displayName,
                      view.chapterStart,
                      view.verseStart,
                      view.chapterEnd,
                      verse
                    );
                    completeSelection(reference);
                  }}
                />
              );
            })}
          </>
        );
      }
      case 'confirm-chapter': {
        const reference = formatChapterReference(view.book.displayName, view.chapter);
        return (
          <>
            <PickerListRow
              label={`Use ${reference}`}
              showChevron={false}
              onClick={() => completeSelection(reference)}
            />
            <PickerListRow
              label="Add Range"
              onClick={() =>
                setView({
                  kind: 'range-pick-chapter-end',
                  book: view.book,
                  chapterStart: view.chapter,
                })
              }
            />
          </>
        );
      }
      case 'range-pick-chapter-end':
        return Array.from({ length: view.book.chapters.length }, (_, index) => {
          const chapter = index + 1;
          if (chapter <= view.chapterStart) return null;
          return (
            <PickerListRow
              key={chapter}
              label={`Chapter ${chapter}`}
              onClick={() =>
                setView({
                  kind: 'range-pick-chapter-range-end',
                  book: view.book,
                  chapterStart: view.chapterStart,
                  chapterEnd: chapter,
                })
              }
            />
          );
        });
      case 'range-pick-chapter-range-end': {
        const endVerseCount = getChapterVerseCount(view.book, view.chapterEnd);
        return (
          <>
            <PickerListRow
              label="Entire Chapter"
              onClick={() => {
                completeSelection(
                  formatChapterRangeReference(
                    view.book.displayName,
                    view.chapterStart,
                    view.chapterEnd
                  )
                );
              }}
            />
            {Array.from({ length: endVerseCount }, (_, index) => {
              const verse = index + 1;
              return (
                <PickerListRow
                  key={verse}
                  label={`Verse ${verse}`}
                  onClick={() => {
                    completeSelection(
                      formatChapterRangeEndingVerseReference(
                        view.book.displayName,
                        view.chapterStart,
                        view.chapterEnd,
                        verse
                      )
                    );
                  }}
                />
              );
            })}
          </>
        );
      }
      default:
        return null;
    }
  };

  const title = getPickerTitle(view);
  const canGoBack = view.kind !== 'books';

  return (
    <Popover open={open} onOpenChange={handleOpenChange} modal={false}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          className={cn('shrink-0', className)}
        >
          Browse
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" side="bottom" className="w-72 p-0">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          {canGoBack ? (
            <button
              type="button"
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              aria-label="Go back"
              onClick={() => setView(getPreviousPickerView(view))}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          ) : null}
          <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{title}</p>
        </div>
        <div
          className="scrollbar-visible max-h-64 overflow-y-auto overscroll-y-contain"
          onWheel={handleListWheel}
        >
          {renderPickerBody()}
        </div>
      </PopoverContent>
    </Popover>
  );
}
