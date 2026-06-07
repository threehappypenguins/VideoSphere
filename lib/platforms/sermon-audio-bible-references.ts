import { SERMON_AUDIO_BIBLE_TYPED_ABBREVIATIONS } from '@/lib/platforms/sermon-audio-bible-abbreviations';
import {
  SERMON_AUDIO_BIBLE_BOOKS,
  SERMON_AUDIO_MAX_BIBLE_REFERENCES,
  type SermonAudioBibleBook,
} from '@/lib/platforms/sermon-audio-bible-books';

/** Bible books sorted longest display name first for greedy prefix matching. */
const SERMON_AUDIO_BIBLE_BOOKS_BY_DISPLAY_NAME_LENGTH = [...SERMON_AUDIO_BIBLE_BOOKS].sort(
  (a, b) => b.displayName.length - a.displayName.length
);

/**
 * Parses semicolon-separated scripture references from SA `bibleText`.
 * @param bibleText - Raw bibleText field value.
 * @returns Up to two trimmed reference strings.
 */
export function parseBibleReferences(bibleText: string | undefined): string[] {
  if (!bibleText?.trim()) return [];
  return bibleText
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, SERMON_AUDIO_MAX_BIBLE_REFERENCES);
}

/**
 * Serializes scripture references into SA `bibleText` format.
 * @param references - Reference strings to join with semicolons.
 * @returns Semicolon-separated bibleText value, or empty string when none.
 */
export function serializeBibleReferences(references: readonly string[]): string {
  return references
    .map((reference) => reference.trim())
    .filter(Boolean)
    .slice(0, SERMON_AUDIO_MAX_BIBLE_REFERENCES)
    .join('; ');
}

/**
 * Result of validating user-typed scripture input.
 * @property ok - Whether the input is a valid reference.
 * @property reference - Canonical SA reference when valid.
 * @property input - Original typed input when invalid.
 */
export type ValidateTypedBibleReferenceResult =
  | { ok: true; reference: string }
  | { ok: false; input: string };

function isValidChapter(book: SermonAudioBibleBook, chapter: number): boolean {
  return Number.isInteger(chapter) && chapter >= 1 && chapter <= book.chapters.length;
}

function isValidVerse(book: SermonAudioBibleBook, chapter: number, verse: number): boolean {
  if (!isValidChapter(book, chapter)) return false;
  const verseCount = getChapterVerseCount(book, chapter);
  return Number.isInteger(verse) && verse >= 1 && verse <= verseCount;
}

function isAbbreviationLocationBoundary(rest: string): boolean {
  if (rest === '') return true;
  const next = rest[0];
  return next !== undefined && !/[a-zA-Z]/.test(next);
}

/**
 * Matches the longest book name or OSIS/Paratext abbreviation prefix in typed reference input.
 * @param input - Raw user input.
 * @returns Matched book and remaining location segment, or null.
 */
function matchBookFromTypedInput(
  input: string
): { book: SermonAudioBibleBook; rest: string } | null {
  const normalizedInput = input.trim();
  const inputLower = normalizedInput.toLowerCase();

  for (const book of SERMON_AUDIO_BIBLE_BOOKS_BY_DISPLAY_NAME_LENGTH) {
    if (inputLower.startsWith(book.displayName.toLowerCase())) {
      return { book, rest: normalizedInput.slice(book.displayName.length).trim() };
    }
  }

  for (const { abbrev, book } of SERMON_AUDIO_BIBLE_TYPED_ABBREVIATIONS) {
    if (!inputLower.startsWith(abbrev.toLowerCase())) continue;
    const rest = normalizedInput.slice(abbrev.length).trimStart();
    if (!isAbbreviationLocationBoundary(normalizedInput.slice(abbrev.length))) continue;
    return { book, rest };
  }

  return null;
}

/**
 * Parses and formats the chapter/verse portion of a typed reference.
 * @param book - Matched bible book.
 * @param rest - Location segment after the book name.
 * @returns Canonical SA reference string, or null when invalid.
 */
function parseTypedReferenceLocation(book: SermonAudioBibleBook, rest: string): string | null {
  const location = rest.replace(/\s+/g, '');
  if (location === '') return null;

  const chapterOnly = location.match(/^(\d+)$/);
  if (chapterOnly) {
    const chapter = Number(chapterOnly[1]);
    if (!isValidChapter(book, chapter)) return null;
    return formatChapterReference(book.displayName, chapter);
  }

  const chapterRange = location.match(/^(\d+)-(\d+)$/);
  if (chapterRange) {
    const chapterStart = Number(chapterRange[1]);
    const chapterEnd = Number(chapterRange[2]);
    if (
      !isValidChapter(book, chapterStart) ||
      !isValidChapter(book, chapterEnd) ||
      chapterEnd < chapterStart
    ) {
      return null;
    }
    if (chapterStart === chapterEnd) {
      return formatChapterReference(book.displayName, chapterStart);
    }
    return formatChapterRangeReference(book.displayName, chapterStart, chapterEnd);
  }

  const chapterRangeEndingVerse = location.match(/^(\d+)-(\d+):(\d+)$/);
  if (chapterRangeEndingVerse) {
    const chapterStart = Number(chapterRangeEndingVerse[1]);
    const chapterEnd = Number(chapterRangeEndingVerse[2]);
    const verseEnd = Number(chapterRangeEndingVerse[3]);
    if (
      !isValidChapter(book, chapterStart) ||
      !isValidChapter(book, chapterEnd) ||
      chapterEnd < chapterStart ||
      !isValidVerse(book, chapterEnd, verseEnd)
    ) {
      return null;
    }
    return formatChapterRangeEndingVerseReference(
      book.displayName,
      chapterStart,
      chapterEnd,
      verseEnd
    );
  }

  const singleVerse = location.match(/^(\d+):(\d+)$/);
  if (singleVerse) {
    const chapter = Number(singleVerse[1]);
    const verse = Number(singleVerse[2]);
    if (!isValidVerse(book, chapter, verse)) return null;
    return formatSingleVerseReference(book.displayName, chapter, verse);
  }

  const verseRangeSameChapter = location.match(/^(\d+):(\d+)-(\d+)$/);
  if (verseRangeSameChapter) {
    const chapter = Number(verseRangeSameChapter[1]);
    const verseStart = Number(verseRangeSameChapter[2]);
    const verseEnd = Number(verseRangeSameChapter[3]);
    if (
      !isValidVerse(book, chapter, verseStart) ||
      !isValidVerse(book, chapter, verseEnd) ||
      verseEnd < verseStart
    ) {
      return null;
    }
    if (verseStart === verseEnd) {
      return formatSingleVerseReference(book.displayName, chapter, verseStart);
    }
    return formatVerseRangeReference(book.displayName, chapter, verseStart, chapter, verseEnd);
  }

  const verseRangeCrossChapter = location.match(/^(\d+):(\d+)-(\d+):(\d+)$/);
  if (verseRangeCrossChapter) {
    const chapterStart = Number(verseRangeCrossChapter[1]);
    const verseStart = Number(verseRangeCrossChapter[2]);
    const chapterEnd = Number(verseRangeCrossChapter[3]);
    const verseEnd = Number(verseRangeCrossChapter[4]);
    if (
      !isValidVerse(book, chapterStart, verseStart) ||
      !isValidVerse(book, chapterEnd, verseEnd)
    ) {
      return null;
    }
    if (chapterEnd < chapterStart || (chapterEnd === chapterStart && verseEnd < verseStart)) {
      return null;
    }
    if (chapterStart === chapterEnd && verseStart === verseEnd) {
      return formatSingleVerseReference(book.displayName, chapterStart, verseStart);
    }
    return formatVerseRangeReference(
      book.displayName,
      chapterStart,
      verseStart,
      chapterEnd,
      verseEnd
    );
  }

  return null;
}

/**
 * Validates and normalizes a user-typed scripture reference for SA `bibleText`.
 * @param input - Raw typed reference (e.g. `Genesis1`, `John 3:16`).
 * @returns Normalized reference or validation failure with original input.
 */
export function validateAndNormalizeTypedBibleReference(
  input: string
): ValidateTypedBibleReferenceResult {
  const trimmed = input.trim();
  if (!trimmed) {
    return { ok: false, input: trimmed };
  }

  const matched = matchBookFromTypedInput(trimmed);
  if (!matched) {
    return { ok: false, input: trimmed };
  }

  const reference = parseTypedReferenceLocation(matched.book, matched.rest);
  if (!reference) {
    return { ok: false, input: trimmed };
  }

  return { ok: true, reference };
}

/**
 * Finds a bible book by display name (case-insensitive).
 * @param displayName - English book name.
 * @returns Matching book definition, or undefined.
 */
export function findSermonAudioBibleBook(displayName: string): SermonAudioBibleBook | undefined {
  const normalized = displayName.trim().toLowerCase();
  return SERMON_AUDIO_BIBLE_BOOKS.find((book) => book.displayName.toLowerCase() === normalized);
}

/**
 * Formats a single-verse scripture reference.
 * @param book - English book name.
 * @param chapter - Chapter number.
 * @param verse - Verse number.
 * @returns Reference string (e.g. `Genesis 1:1`).
 */
export function formatSingleVerseReference(book: string, chapter: number, verse: number): string {
  return `${book} ${chapter}:${verse}`;
}

/**
 * Formats a verse-range scripture reference within one or more chapters.
 * @param book - English book name.
 * @param chapterStart - Starting chapter number.
 * @param verseStart - Starting verse number.
 * @param chapterEnd - Ending chapter number.
 * @param verseEnd - Ending verse number.
 * @returns Reference string (e.g. `Genesis 1:1-5` or `Genesis 1:1-2:3`).
 */
export function formatVerseRangeReference(
  book: string,
  chapterStart: number,
  verseStart: number,
  chapterEnd: number,
  verseEnd: number
): string {
  if (chapterStart === chapterEnd) {
    return `${book} ${chapterStart}:${verseStart}-${verseEnd}`;
  }
  return `${book} ${chapterStart}:${verseStart}-${chapterEnd}:${verseEnd}`;
}

/**
 * Formats an entire-chapter scripture reference.
 * @param book - English book name.
 * @param chapter - Chapter number.
 * @returns Reference string (e.g. `Genesis 1`).
 */
export function formatChapterReference(book: string, chapter: number): string {
  return `${book} ${chapter}`;
}

/**
 * Formats a chapter-range scripture reference.
 * @param book - English book name.
 * @param chapterStart - Starting chapter number.
 * @param chapterEnd - Ending chapter number.
 * @returns Reference string (e.g. `Genesis 1-3`).
 */
export function formatChapterRangeReference(
  book: string,
  chapterStart: number,
  chapterEnd: number
): string {
  return `${book} ${chapterStart}-${chapterEnd}`;
}

/**
 * Formats a chapter-through-verse range starting at the first verse of the start chapter.
 * @param book - English book name.
 * @param chapterStart - Starting chapter number.
 * @param chapterEnd - Ending chapter number.
 * @param verseEnd - Ending verse number in the final chapter.
 * @returns Reference string (e.g. `Genesis 1:1-3:3`).
 */
export function formatChapterRangeEndingVerseReference(
  book: string,
  chapterStart: number,
  chapterEnd: number,
  verseEnd: number
): string {
  return formatVerseRangeReference(book, chapterStart, 1, chapterEnd, verseEnd);
}

/**
 * Returns whether another reference can be added to bibleText.
 * @param references - Current reference list.
 * @returns True when fewer than two references are stored.
 */
export function canAddBibleReference(references: readonly string[]): boolean {
  return references.length < SERMON_AUDIO_MAX_BIBLE_REFERENCES;
}

/**
 * Adds a reference if under the limit and not already present (case-insensitive).
 * @param references - Current reference list.
 * @param nextReference - Reference to add.
 * @returns Updated reference list.
 */
export function addBibleReference(references: readonly string[], nextReference: string): string[] {
  const trimmed = nextReference.trim();
  if (!trimmed || !canAddBibleReference(references)) {
    return [...references];
  }
  const exists = references.some((reference) => reference.toLowerCase() === trimmed.toLowerCase());
  if (exists) return [...references];
  return [...references, trimmed].slice(0, SERMON_AUDIO_MAX_BIBLE_REFERENCES);
}

/**
 * Removes a scripture reference from the list.
 * @param references - Current reference list.
 * @param referenceToRemove - Exact reference string to remove.
 * @returns Updated reference list.
 */
export function removeBibleReference(
  references: readonly string[],
  referenceToRemove: string
): string[] {
  return references.filter((reference) => reference !== referenceToRemove);
}

/**
 * Returns the verse count for a chapter in a book.
 * @param book - Bible book definition.
 * @param chapter - One-based chapter number.
 * @returns Verse count, or 0 when invalid.
 */
export function getChapterVerseCount(book: SermonAudioBibleBook, chapter: number): number {
  if (!Number.isInteger(chapter) || chapter < 1 || chapter > book.chapters.length) {
    return 0;
  }
  return book.chapters[chapter - 1] ?? 0;
}
