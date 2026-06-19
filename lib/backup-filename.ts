import type { BackupDateFormat, BackupDateSuffix, BackupFileNameSettings } from '@/types';

/** Maximum length for the optional backup filename series segment. */
export const MAX_BACKUP_SERIES_LENGTH = 64;

/** Maximum length for the optional backup filename suffix segment. */
export const MAX_BACKUP_SUFFIX_LENGTH = 64;

/** Maximum length for injectable backup metadata text fields (album artist, album, genre). */
export const MAX_BACKUP_METADATA_FIELD_LENGTH = 255;

/** Default backup filename settings applied when a draft has no stored override. */
export const DEFAULT_BACKUP_FILE_NAME_SETTINGS: Required<
  Omit<BackupFileNameSettings, 'datePrefixDate'>
> = {
  datePrefixEnabled: true,
  dateFormat: 'YYYYMMDD',
  dateSuffixEnabled: false,
  dateSuffix: 'AM',
  seriesEnabled: false,
  series: '',
  suffixEnabled: false,
  suffix: '',
  yearFolderEnabled: true,
  metadataEnabled: false,
  albumArtist: '',
  album: '',
  genre: '',
};

const BACKUP_DATE_FORMATS: readonly BackupDateFormat[] = [
  'YYYYMMDD',
  'YYYY-MM-DD',
  'YYYYDDMM',
  'YYYY-DD-MM',
];

const BACKUP_DATE_SUFFIXES: readonly BackupDateSuffix[] = ['AM', '-AM', 'PM', '-PM'];

const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const INVALID_FILENAME_CHARS = /[\\/:*?"<>|\u0000-\u001f]/g;

/**
 * Returns today's calendar date as `YYYY-MM-DD` in the local timezone.
 * @returns ISO-like calendar date string suitable for `<input type="date">`.
 */
export function todayCalendarDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Returns whether `value` is a valid calendar date in `YYYY-MM-DD` form.
 * @param value - Candidate calendar date string.
 * @returns True when the value is a real calendar date.
 */
export function isValidCalendarDateString(value: string): boolean {
  const trimmed = value.trim();
  if (!CALENDAR_DATE_PATTERN.test(trimmed)) return false;

  const [year, month, day] = trimmed.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/**
 * Returns whether `value` is a supported backup date format token.
 * @param value - Candidate format string.
 * @returns True when the value is a known backup date format.
 */
export function isBackupDateFormat(value: string): value is BackupDateFormat {
  return (BACKUP_DATE_FORMATS as readonly string[]).includes(value);
}

/**
 * Returns whether `value` is a supported backup date suffix token.
 * @param value - Candidate suffix string.
 * @returns True when the value is a known backup date suffix.
 */
export function isBackupDateSuffix(value: string): value is BackupDateSuffix {
  return (BACKUP_DATE_SUFFIXES as readonly string[]).includes(value);
}

/**
 * Normalizes partial backup filename settings into a complete, validated object.
 * @param value - Raw settings from draft JSON or API input.
 * @returns Resolved backup filename settings with defaults applied.
 */
export function normalizeBackupFileNameSettings(value: unknown): BackupFileNameSettings {
  if (value === null || value === undefined || typeof value !== 'object' || Array.isArray(value)) {
    return {
      ...DEFAULT_BACKUP_FILE_NAME_SETTINGS,
      datePrefixDate: todayCalendarDateString(),
    };
  }

  const raw = value as Record<string, unknown>;
  const dateFormat =
    typeof raw.dateFormat === 'string' && isBackupDateFormat(raw.dateFormat)
      ? raw.dateFormat
      : DEFAULT_BACKUP_FILE_NAME_SETTINGS.dateFormat;

  const series =
    typeof raw.series === 'string'
      ? raw.series.slice(0, MAX_BACKUP_SERIES_LENGTH)
      : DEFAULT_BACKUP_FILE_NAME_SETTINGS.series;

  const suffix =
    typeof raw.suffix === 'string'
      ? raw.suffix.slice(0, MAX_BACKUP_SUFFIX_LENGTH)
      : DEFAULT_BACKUP_FILE_NAME_SETTINGS.suffix;

  const albumArtist =
    typeof raw.albumArtist === 'string'
      ? raw.albumArtist.slice(0, MAX_BACKUP_METADATA_FIELD_LENGTH)
      : DEFAULT_BACKUP_FILE_NAME_SETTINGS.albumArtist;

  const album =
    typeof raw.album === 'string'
      ? raw.album.slice(0, MAX_BACKUP_METADATA_FIELD_LENGTH)
      : DEFAULT_BACKUP_FILE_NAME_SETTINGS.album;

  const genre =
    typeof raw.genre === 'string'
      ? raw.genre.slice(0, MAX_BACKUP_METADATA_FIELD_LENGTH)
      : DEFAULT_BACKUP_FILE_NAME_SETTINGS.genre;

  const datePrefixDate =
    typeof raw.datePrefixDate === 'string' && isValidCalendarDateString(raw.datePrefixDate)
      ? raw.datePrefixDate.trim()
      : undefined;

  return {
    datePrefixEnabled:
      typeof raw.datePrefixEnabled === 'boolean'
        ? raw.datePrefixEnabled
        : DEFAULT_BACKUP_FILE_NAME_SETTINGS.datePrefixEnabled,
    ...(datePrefixDate !== undefined ? { datePrefixDate } : {}),
    dateFormat,
    dateSuffixEnabled:
      typeof raw.dateSuffixEnabled === 'boolean'
        ? raw.dateSuffixEnabled
        : DEFAULT_BACKUP_FILE_NAME_SETTINGS.dateSuffixEnabled,
    dateSuffix:
      typeof raw.dateSuffix === 'string' && isBackupDateSuffix(raw.dateSuffix)
        ? raw.dateSuffix
        : DEFAULT_BACKUP_FILE_NAME_SETTINGS.dateSuffix,
    seriesEnabled:
      typeof raw.seriesEnabled === 'boolean'
        ? raw.seriesEnabled
        : DEFAULT_BACKUP_FILE_NAME_SETTINGS.seriesEnabled,
    series,
    suffixEnabled:
      typeof raw.suffixEnabled === 'boolean'
        ? raw.suffixEnabled
        : DEFAULT_BACKUP_FILE_NAME_SETTINGS.suffixEnabled,
    suffix,
    yearFolderEnabled:
      typeof raw.yearFolderEnabled === 'boolean'
        ? raw.yearFolderEnabled
        : DEFAULT_BACKUP_FILE_NAME_SETTINGS.yearFolderEnabled,
    metadataEnabled:
      typeof raw.metadataEnabled === 'boolean'
        ? raw.metadataEnabled
        : DEFAULT_BACKUP_FILE_NAME_SETTINGS.metadataEnabled,
    albumArtist,
    album,
    genre,
  };
}

/**
 * Merges a partial backup filename settings patch onto existing settings.
 * @param base - Current stored settings.
 * @param patch - Partial update from PATCH/editor.
 * @returns Merged settings after normalization.
 */
export function mergeBackupFileNameSettingsPatch(
  base: BackupFileNameSettings | undefined,
  patch: unknown
): BackupFileNameSettings {
  if (patch === null || patch === undefined) {
    return normalizeBackupFileNameSettings(base);
  }
  if (typeof patch !== 'object' || Array.isArray(patch)) {
    return normalizeBackupFileNameSettings(base);
  }

  const current = normalizeBackupFileNameSettings(base);
  const raw = patch as Record<string, unknown>;
  return normalizeBackupFileNameSettings({
    ...current,
    ...(typeof raw.datePrefixEnabled === 'boolean'
      ? { datePrefixEnabled: raw.datePrefixEnabled }
      : {}),
    ...(typeof raw.datePrefixDate === 'string' ? { datePrefixDate: raw.datePrefixDate } : {}),
    ...(typeof raw.dateFormat === 'string' ? { dateFormat: raw.dateFormat } : {}),
    ...(typeof raw.dateSuffixEnabled === 'boolean'
      ? { dateSuffixEnabled: raw.dateSuffixEnabled }
      : {}),
    ...(typeof raw.dateSuffix === 'string' ? { dateSuffix: raw.dateSuffix } : {}),
    ...(typeof raw.seriesEnabled === 'boolean' ? { seriesEnabled: raw.seriesEnabled } : {}),
    ...(typeof raw.series === 'string' ? { series: raw.series } : {}),
    ...(typeof raw.suffixEnabled === 'boolean' ? { suffixEnabled: raw.suffixEnabled } : {}),
    ...(typeof raw.suffix === 'string' ? { suffix: raw.suffix } : {}),
    ...(typeof raw.yearFolderEnabled === 'boolean'
      ? { yearFolderEnabled: raw.yearFolderEnabled }
      : {}),
    ...(typeof raw.metadataEnabled === 'boolean' ? { metadataEnabled: raw.metadataEnabled } : {}),
    ...(typeof raw.albumArtist === 'string' ? { albumArtist: raw.albumArtist } : {}),
    ...(typeof raw.album === 'string' ? { album: raw.album } : {}),
    ...(typeof raw.genre === 'string' ? { genre: raw.genre } : {}),
  });
}

/**
 * Resolves the calendar date used for the backup filename prefix.
 * @param settings - Backup filename settings from the draft.
 * @returns Calendar date string (`YYYY-MM-DD`).
 */
export function resolveBackupDatePrefixCalendarDate(
  settings: BackupFileNameSettings | undefined
): string {
  const normalized = normalizeBackupFileNameSettings(settings);
  if (normalized.datePrefixDate) {
    return normalized.datePrefixDate;
  }

  return todayCalendarDateString();
}

/**
 * Normalizes backup naming settings for persistence, filling in today's date when the prefix is enabled but unset.
 * @param value - Raw settings from the editor.
 * @returns Settings ready to store on a draft.
 */
export function backupNamingForStorage(value: unknown): BackupFileNameSettings {
  const normalized = normalizeBackupFileNameSettings(value);
  if (
    (normalized.datePrefixEnabled !== false || normalized.yearFolderEnabled !== false) &&
    !normalized.datePrefixDate
  ) {
    return { ...normalized, datePrefixDate: todayCalendarDateString() };
  }
  return normalized;
}

/**
 * Removes characters that are invalid in filenames on common operating systems.
 * @param value - Raw filename segment.
 * @returns Sanitized segment safe for cross-platform filenames.
 */
export function sanitizeBackupFilenameComponent(value: string): string {
  return value
    .replace(INVALID_FILENAME_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, '');
}

/**
 * Formats a calendar date for use in backup filenames.
 * @param calendarDate - Date in `YYYY-MM-DD` form.
 * @param format - Selected date format token.
 * @returns Formatted date string, or an empty string when the input is invalid.
 */
export function formatBackupDatePrefix(calendarDate: string, format: BackupDateFormat): string {
  if (!isValidCalendarDateString(calendarDate)) return '';

  const [year, month, day] = calendarDate.trim().split('-');

  switch (format) {
    case 'YYYYMMDD':
      return `${year}${month}${day}`;
    case 'YYYY-MM-DD':
      return `${year}-${month}-${day}`;
    case 'YYYYDDMM':
      return `${year}${day}${month}`;
    case 'YYYY-DD-MM':
      return `${year}-${day}-${month}`;
    default: {
      const exhaustiveCheck: never = format;
      return exhaustiveCheck;
    }
  }
}

/**
 * Formats a calendar date for backup filenames, optionally appending an AM/PM suffix to the date.
 * @param calendarDate - Date in `YYYY-MM-DD` form.
 * @param format - Selected date format token.
 * @param options - Optional date suffix settings.
 * @returns Formatted date string, or an empty string when the input is invalid.
 */
export function formatBackupDatePrefixWithSuffix(
  calendarDate: string,
  format: BackupDateFormat,
  options?: Pick<BackupFileNameSettings, 'dateSuffixEnabled' | 'dateSuffix'>
): string {
  const base = formatBackupDatePrefix(calendarDate, format);
  if (!base || options?.dateSuffixEnabled !== true) {
    return base;
  }

  const suffix =
    options.dateSuffix && isBackupDateSuffix(options.dateSuffix)
      ? options.dateSuffix
      : DEFAULT_BACKUP_FILE_NAME_SETTINGS.dateSuffix;

  return `${base}${suffix}`;
}

/**
 * Resolves a file extension from a video content type.
 * @param contentType - MIME type of the uploaded video.
 * @returns Lowercase extension without a leading dot.
 */
export function backupExtensionFromContentType(contentType: string | undefined): string {
  const ct = (contentType ?? '').toLowerCase();
  if (ct.includes('mp4')) return 'mp4';
  if (ct.includes('quicktime')) return 'mov';
  if (ct.includes('webm')) return 'webm';
  if (ct.includes('x-matroska')) return 'mkv';
  return 'mp4';
}

/**
 * Builds the backup filename from draft settings and metadata.
 * @param input - Title, MIME type, naming settings, and whether to include the extension.
 * @returns Cross-platform-safe backup filename, with or without extension.
 */
export function buildBackupFileName(input: {
  title: string;
  contentType?: string;
  settings?: BackupFileNameSettings;
  /** When false, omits the file extension (used for UI previews). Default true. */
  includeExtension?: boolean;
}): string {
  const settings = normalizeBackupFileNameSettings(input.settings);
  const parts: string[] = [];

  if (settings.datePrefixEnabled) {
    const calendarDate = resolveBackupDatePrefixCalendarDate(settings);
    const datePart = sanitizeBackupFilenameComponent(
      formatBackupDatePrefixWithSuffix(calendarDate, settings.dateFormat ?? 'YYYYMMDD', {
        dateSuffixEnabled: settings.dateSuffixEnabled,
        dateSuffix: settings.dateSuffix,
      })
    );
    if (datePart) {
      parts.push(datePart);
    }
  }

  if (settings.seriesEnabled) {
    const seriesPart = sanitizeBackupFilenameComponent(settings.series ?? '');
    if (seriesPart) {
      parts.push(seriesPart);
    }
  }

  const titlePart = sanitizeBackupFilenameComponent(input.title.trim()) || 'VideoSphere Backup';
  let finalTitlePart = titlePart;
  if (settings.suffixEnabled) {
    const suffixPart = sanitizeBackupFilenameComponent(settings.suffix ?? '');
    if (suffixPart) {
      finalTitlePart = `${titlePart} (${suffixPart})`;
    }
  }
  parts.push(finalTitlePart);

  const baseName = parts.join(' - ');
  if (input.includeExtension === false) {
    return baseName;
  }

  const ext = backupExtensionFromContentType(input.contentType);
  return `${baseName}.${ext}`;
}

/**
 * Resolves the year subfolder name for backup uploads from the selected calendar date.
 * @param settings - Backup filename settings from the draft.
 * @returns Four-digit year string, or undefined when year folders are disabled.
 */
export function resolveBackupYearFolderName(
  settings: BackupFileNameSettings | undefined
): string | undefined {
  const normalized = normalizeBackupFileNameSettings(settings);
  if (normalized.yearFolderEnabled === false) {
    return undefined;
  }

  const calendarDate = resolveBackupDatePrefixCalendarDate(settings);
  const year = calendarDate.slice(0, 4);
  return /^\d{4}$/.test(year) ? year : undefined;
}

/**
 * Builds the remote-relative backup path shown in previews and used at upload time.
 * @param input - Backup filename and naming settings.
 * @returns Path relative to the configured remote root, e.g. `2026/20260618 - Title.mp4`.
 */
export function buildBackupRemoteRelativePath(input: {
  fileName: string;
  settings?: BackupFileNameSettings;
}): string {
  const fileName = input.fileName.trim();
  const yearFolder = resolveBackupYearFolderName(input.settings);
  if (!yearFolder) {
    return fileName;
  }

  return `${yearFolder}/${fileName}`;
}

/**
 * Maximum numeric suffix tried when disambiguating backup filenames on SFTP/SMB.
 * Ten thousand variants of the same stem in one folder is far beyond realistic backup
 * usage (re-uploading the same draft a handful of times), so we cap the search here.
 */
export const MAX_BACKUP_FILE_COPY_SUFFIX = 9999;

function splitBackupFileName(fileName: string): { stem: string; ext: string } {
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot <= 0) {
    return { stem: fileName, ext: '' };
  }
  return { stem: fileName.slice(0, lastDot), ext: fileName.slice(lastDot) };
}

function backupFileNamesEqual(left: string, right: string, caseInsensitive: boolean): boolean {
  return caseInsensitive ? left.toLowerCase() === right.toLowerCase() : left === right;
}

/**
 * Returns the Windows-style copy index for a filename in a duplicate series, if it matches.
 * @param fileName - Candidate filename in the upload directory.
 * @param stem - Base filename stem (without extension).
 * @param ext - Extension including the leading dot, or an empty string.
 * @param caseInsensitive - Whether to compare names case-insensitively.
 * @returns `0` for the base name, a positive integer for `stem (n).ext`, or `null` when unrelated.
 */
function parseBackupFileCopyIndex(
  fileName: string,
  stem: string,
  ext: string,
  caseInsensitive: boolean
): number | null {
  const baseName = `${stem}${ext}`;
  if (backupFileNamesEqual(fileName, baseName, caseInsensitive)) {
    return 0;
  }

  const prefix = `${stem} (`;
  const suffix = `)${ext}`;
  if (
    fileName.length <= prefix.length + suffix.length ||
    !fileName.endsWith(suffix) ||
    (caseInsensitive
      ? !fileName.toLowerCase().startsWith(prefix.toLowerCase())
      : !fileName.startsWith(prefix))
  ) {
    return null;
  }

  const middle = fileName.slice(prefix.length, fileName.length - suffix.length);
  if (!/^\d+$/.test(middle)) {
    return null;
  }

  return Number(middle);
}

/**
 * Picks the first available backup filename in a Windows-style duplicate series.
 * When `sermon.mp4` already exists, returns `sermon (1).mp4`, then `sermon (2).mp4`, and so on.
 * @param fileName - Desired backup filename, including extension.
 * @param existingFileNames - Filenames already present in the target remote directory.
 * @param options - Matching options for remote filesystem semantics.
 * @param options.caseInsensitive - When true, treats names as equal regardless of case (SMB).
 * @returns A filename that does not collide with `existingFileNames` under the chosen rules.
 * @throws {Error} When every slot from the base name through
 *   {@link MAX_BACKUP_FILE_COPY_SUFFIX} is already occupied (not expected in practice).
 */
export function resolveUniqueBackupFileName(
  fileName: string,
  existingFileNames: Iterable<string>,
  options?: { caseInsensitive?: boolean }
): string {
  const trimmed = fileName.trim();
  const { stem, ext } = splitBackupFileName(trimmed);
  const caseInsensitive = options?.caseInsensitive === true;

  const occupied = new Set<number>();
  for (const existing of existingFileNames) {
    const index = parseBackupFileCopyIndex(existing.trim(), stem, ext, caseInsensitive);
    if (index != null) {
      occupied.add(index);
    }
  }

  if (!occupied.has(0)) {
    return `${stem}${ext}`;
  }

  for (let copyIndex = 1; copyIndex <= MAX_BACKUP_FILE_COPY_SUFFIX; copyIndex += 1) {
    if (!occupied.has(copyIndex)) {
      return `${stem} (${copyIndex})${ext}`;
    }
  }

  // Exhaustion requires base + (1)..(9999) all present in one folder — not a realistic backup
  // scenario (users might collide a few times reusing a draft, not thousands). Fail loudly
  // instead of returning an occupied name and risking overwrite.
  throw new Error(
    `No available backup filename for "${trimmed}" after ${MAX_BACKUP_FILE_COPY_SUFFIX} duplicates in the target folder.`
  );
}
