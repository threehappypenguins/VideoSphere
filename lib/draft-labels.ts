import { tagListIncludesEquivalent } from '@/lib/platforms/sermon-audio-tags';
import type { DraftLabelDefinition } from '@/types';

/** Maximum organizational labels stored on a single draft. */
export const MAX_DRAFT_LABELS_PER_DRAFT = 20;

/** Maximum characters per draft label. */
export const MAX_DRAFT_LABEL_LENGTH = 50;

/** Maximum labels kept in a user's saved label library. */
export const MAX_DRAFT_LABEL_LIBRARY_SIZE = 200;

/** Preset swatches for draft label colors. */
export const DRAFT_LABEL_COLOR_PRESETS = [
  '#6366f1',
  '#8b5cf6',
  '#ec4899',
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#14b8a6',
  '#3b82f6',
  '#64748b',
] as const;

/** Default label color when none is stored. */
export const DEFAULT_DRAFT_LABEL_COLOR = DRAFT_LABEL_COLOR_PRESETS[9];

const DRAFT_LABEL_HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

/**
 * Normalizes a draft organizational label for storage and comparison.
 * @param raw - Raw label text from the editor or API.
 * @returns Trimmed label with collapsed internal whitespace.
 */
export function normalizeDraftLabel(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

/**
 * Validates and normalizes a draft label hex color.
 * @param raw - Raw color from API or UI.
 * @returns Normalized `#RRGGBB` color or the default label color.
 */
export function normalizeDraftLabelColor(raw: unknown): string {
  if (typeof raw !== 'string') return DEFAULT_DRAFT_LABEL_COLOR;
  const trimmed = raw.trim();
  if (!DRAFT_LABEL_HEX_COLOR_PATTERN.test(trimmed)) return DEFAULT_DRAFT_LABEL_COLOR;
  return trimmed.toLowerCase();
}

/**
 * Picks a stable preset color for a label name.
 * @param name - Label text.
 * @returns Hex color from {@link DRAFT_LABEL_COLOR_PRESETS}.
 */
export function defaultDraftLabelColorForName(name: string): string {
  const normalized = normalizeDraftLabel(name).toLowerCase();
  if (!normalized) return DEFAULT_DRAFT_LABEL_COLOR;
  let hash = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    hash = (hash * 31 + normalized.charCodeAt(index)) >>> 0;
  }
  return DRAFT_LABEL_COLOR_PRESETS[hash % DRAFT_LABEL_COLOR_PRESETS.length];
}

/**
 * Parses comma-separated draft label input (Enter/comma commit in the UI).
 * @param raw - Raw text from the label input field.
 * @returns Normalized label strings ready to store.
 */
export function parseDraftLabelInput(raw: string): string[] {
  return raw.split(',').map(normalizeDraftLabel).filter(Boolean);
}

/**
 * Returns whether a label already exists in a list (case-insensitive).
 * @param labels - Existing stored labels.
 * @param candidate - Label to check for duplication.
 * @returns True when an equivalent label is already present.
 */
export function draftLabelListIncludesEquivalent(
  labels: readonly string[],
  candidate: string
): boolean {
  return tagListIncludesEquivalent(labels, candidate);
}

/**
 * Merges parsed labels into an existing list without case-insensitive duplicates.
 * @param labels - Existing stored labels.
 * @param parsed - Newly parsed labels to add.
 * @returns Updated label list preserving first-seen casing.
 */
export function mergeUniqueDraftLabels(
  labels: readonly string[],
  parsed: readonly string[]
): string[] {
  const merged = [...labels];
  for (const label of parsed) {
    const normalized = normalizeDraftLabel(label);
    if (!normalized) continue;
    if (!draftLabelListIncludesEquivalent(merged, normalized)) {
      merged.push(normalized);
    }
  }
  return merged;
}

/**
 * Normalizes and deduplicates a label array from persisted JSON or API input.
 * @param value - Raw label list.
 * @returns Case-insensitively unique labels in first-seen order.
 */
export function normalizeDraftLabelList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const merged: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const normalized = normalizeDraftLabel(item);
    if (!normalized) continue;
    if (!draftLabelListIncludesEquivalent(merged, normalized)) {
      merged.push(normalized);
    }
  }
  return merged;
}

/**
 * Normalizes one saved draft label definition from storage or API input.
 * @param value - Raw label definition or legacy string entry.
 * @returns Parsed definition or null when invalid.
 */
export function normalizeDraftLabelDefinition(value: unknown): DraftLabelDefinition | null {
  if (typeof value === 'string') {
    const name = normalizeDraftLabel(value);
    if (!name) return null;
    return { name, color: defaultDraftLabelColorForName(name) };
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const name = normalizeDraftLabel(String(record.name ?? ''));
  if (!name) return null;
  return {
    name,
    color: normalizeDraftLabelColor(record.color ?? defaultDraftLabelColorForName(name)),
  };
}

/**
 * Normalizes a user's saved draft label library from MongoDB or API input.
 * Accepts legacy `string[]` entries and `{ name, color }` objects.
 * @param value - Raw library value.
 * @returns Deduplicated definitions preserving first-seen name casing.
 */
export function normalizeDraftLabelLibrary(value: unknown): DraftLabelDefinition[] {
  if (!Array.isArray(value)) return [];
  const merged: DraftLabelDefinition[] = [];
  for (const item of value) {
    const definition = normalizeDraftLabelDefinition(item);
    if (!definition) continue;
    const existingIndex = merged.findIndex(
      (entry) => entry.name.toLowerCase() === definition.name.toLowerCase()
    );
    if (existingIndex >= 0) {
      merged[existingIndex] = {
        name: merged[existingIndex].name,
        color: definition.color,
      };
      continue;
    }
    merged.push(definition);
  }
  return merged;
}

/**
 * Merges label names into a saved library, preserving existing colors.
 * @param library - Existing saved definitions.
 * @param names - Label names to upsert.
 * @returns Updated library with default colors for newly added names.
 */
export function upsertDraftLabelNamesInLibrary(
  library: readonly DraftLabelDefinition[],
  names: readonly string[]
): DraftLabelDefinition[] {
  const merged = library.map((entry) => ({ ...entry }));
  for (const rawName of names) {
    const name = normalizeDraftLabel(rawName);
    if (!name) continue;
    const existingIndex = merged.findIndex(
      (entry) => entry.name.toLowerCase() === name.toLowerCase()
    );
    if (existingIndex >= 0) continue;
    merged.push({ name, color: defaultDraftLabelColorForName(name) });
  }
  return merged;
}

/**
 * Merges incoming label definitions into a library by name (case-insensitive).
 * Updates color when an incoming entry specifies one.
 * @param library - Existing saved definitions.
 * @param incoming - Definitions to merge.
 * @returns Updated library.
 */
export function mergeDraftLabelLibraryEntries(
  library: readonly DraftLabelDefinition[],
  incoming: readonly DraftLabelDefinition[]
): DraftLabelDefinition[] {
  const merged = library.map((entry) => ({ ...entry }));
  for (const entry of incoming) {
    const name = normalizeDraftLabel(entry.name);
    if (!name) continue;
    const color = normalizeDraftLabelColor(entry.color);
    const existingIndex = merged.findIndex(
      (existing) => existing.name.toLowerCase() === name.toLowerCase()
    );
    if (existingIndex >= 0) {
      merged[existingIndex] = { name: merged[existingIndex].name, color };
      continue;
    }
    merged.push({ name, color });
  }
  return merged;
}

/**
 * Builds a case-insensitive lookup map from label name to color.
 * @param library - Saved label definitions.
 * @returns Map keyed by lowercase label name.
 */
export function buildDraftLabelColorMap(
  library: readonly DraftLabelDefinition[]
): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of library) {
    map.set(entry.name.toLowerCase(), entry.color);
  }
  return map;
}

/**
 * Resolves the display color for a label name from a saved library.
 * @param library - Saved label definitions.
 * @param name - Label name on a draft.
 * @returns Hex color for the label chip.
 */
export function lookupDraftLabelColor(
  library: readonly DraftLabelDefinition[],
  name: string
): string {
  const normalized = normalizeDraftLabel(name);
  if (!normalized) return DEFAULT_DRAFT_LABEL_COLOR;
  const match = library.find((entry) => entry.name.toLowerCase() === normalized.toLowerCase());
  return match?.color ?? defaultDraftLabelColorForName(normalized);
}

/**
 * Converts a hex color to an rgba string for chip backgrounds.
 * @param hex - `#RRGGBB` color.
 * @param alpha - Opacity from 0 to 1.
 * @returns CSS rgba color string.
 */
export function draftLabelColorWithAlpha(hex: string, alpha: number): string {
  const normalized = normalizeDraftLabelColor(hex);
  const value = normalized.slice(1);
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

/**
 * Filters a saved label library for autocomplete suggestions.
 * @param library - User's saved draft labels.
 * @param query - Optional case-insensitive substring filter.
 * @param limit - Maximum suggestions to return.
 * @returns Matching definitions sorted alphabetically (case-insensitive).
 */
export function filterDraftLabelSuggestions(
  library: readonly DraftLabelDefinition[],
  query?: string,
  limit = 12
): DraftLabelDefinition[] {
  const trimmedQuery = query?.trim().toLowerCase() ?? '';
  const filtered = trimmedQuery
    ? library.filter((entry) => entry.name.toLowerCase().includes(trimmedQuery))
    : [...library];
  return filtered
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    .slice(0, limit);
}

/**
 * Validates a draft label list from API input.
 * @param value - Raw request body field.
 * @returns Parsed labels or a validation error message.
 */
export function parseDraftLabelsFromRequestBody(
  value: unknown
): { ok: true; value: string[] } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, value: [] };
  if (!Array.isArray(value)) {
    return { ok: false, error: 'labels must be an array of strings' };
  }

  const normalized = normalizeDraftLabelList(value);
  if (normalized.length > MAX_DRAFT_LABELS_PER_DRAFT) {
    return {
      ok: false,
      error: `labels must contain at most ${MAX_DRAFT_LABELS_PER_DRAFT} items`,
    };
  }

  for (const label of normalized) {
    if (label.length > MAX_DRAFT_LABEL_LENGTH) {
      return {
        ok: false,
        error: `each label must be at most ${MAX_DRAFT_LABEL_LENGTH} characters`,
      };
    }
  }

  return { ok: true, value: normalized };
}

/**
 * Validates a user's saved draft label library from API input.
 * Accepts legacy string entries and `{ name, color }` objects.
 * @param value - Raw request body field.
 * @returns Parsed library or a validation error message.
 */
export function parseDraftLabelLibraryFromRequestBody(
  value: unknown
): { ok: true; value: DraftLabelDefinition[] } | { ok: false; error: string } {
  if (value === undefined) {
    return { ok: false, error: 'labels must be provided' };
  }
  if (!Array.isArray(value)) {
    return { ok: false, error: 'labels must be an array' };
  }

  const normalized = normalizeDraftLabelLibrary(value);
  if (normalized.length > MAX_DRAFT_LABEL_LIBRARY_SIZE) {
    return {
      ok: false,
      error: `labels must contain at most ${MAX_DRAFT_LABEL_LIBRARY_SIZE} items`,
    };
  }

  for (const entry of normalized) {
    if (entry.name.length > MAX_DRAFT_LABEL_LENGTH) {
      return {
        ok: false,
        error: `each label must be at most ${MAX_DRAFT_LABEL_LENGTH} characters`,
      };
    }
  }

  return { ok: true, value: normalized };
}

/**
 * Returns labels removed from a library after a settings update.
 * @param previous - Library before the update.
 * @param next - Library after the update.
 * @returns Labels present in `previous` but not in `next` (case-insensitive).
 */
export function draftLabelsRemovedFromLibrary(
  previous: readonly DraftLabelDefinition[],
  next: readonly DraftLabelDefinition[]
): string[] {
  const nextNames = next.map((entry) => entry.name);
  return previous
    .map((entry) => entry.name)
    .filter((label) => !draftLabelListIncludesEquivalent(nextNames, label));
}
