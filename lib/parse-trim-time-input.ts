/** Preset jump distances for coarse trim nudges (seconds). */
export const TRIM_JUMP_STEP_OPTIONS = [1, 5, 10] as const;

/**
 * Jump distance preset in seconds for coarse trim nudges.
 * @property 1 - One-second steps.
 * @property 5 - Five-second steps.
 * @property 10 - Ten-second steps.
 */
export type TrimJumpStepSeconds = (typeof TRIM_JUMP_STEP_OPTIONS)[number];

/**
 * Formats the seconds component of a trim timestamp, optionally zero-padded.
 * @param seconds - Seconds within the current minute (may include a fraction).
 * @param pad - Whether whole-second values should be zero-padded to two digits.
 * @returns Formatted seconds segment.
 */
function formatTrimSecondsComponent(seconds: number, pad: boolean): string {
  const wholeSeconds = Math.floor(seconds);
  const fraction = seconds - wholeSeconds;

  if (fraction >= 0.001) {
    const wholePart = pad ? String(wholeSeconds).padStart(2, '0') : String(wholeSeconds);
    const fracText = seconds.toFixed(3).replace(/\.?0+$/, '');
    const decimalPart = fracText.includes('.') ? fracText.slice(fracText.indexOf('.')) : '';
    return `${wholePart}${decimalPart}`;
  }

  const text = String(wholeSeconds);
  return pad ? text.padStart(2, '0') : text;
}

/**
 * Formats seconds for display inside an editable trim timestamp field.
 * Uses YouTube-style `H:MM:SS` / `M:SS` labels; fractional values keep colons
 * (`1:33:15.867`) so editing matches the read-only display instead of raw seconds.
 * @param seconds - Timestamp in seconds.
 * @returns String suitable for pre-filling a trim time input.
 */
export function formatTrimTimeInputValue(seconds: number): string {
  const safeSeconds = Math.max(0, seconds);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainingSeconds = safeSeconds % 60;

  if (hours > 0) {
    const paddedMinutes = minutes.toString().padStart(2, '0');
    return `${hours}:${paddedMinutes}:${formatTrimSecondsComponent(remainingSeconds, true)}`;
  }

  if (minutes > 0) {
    return `${minutes}:${formatTrimSecondsComponent(remainingSeconds, true)}`;
  }

  return formatTrimSecondsComponent(remainingSeconds, false);
}

/**
 * Parses user-entered trim timestamps.
 * Accepts plain seconds (`90`, `90.5`), `M:SS`, `MM:SS`, `H:MM:SS`, and optional fractional
 * seconds on the final segment (`1:30.5`).
 * @param input - Raw user input.
 * @returns Parsed seconds, or `null` when the input is invalid.
 */
export function parseTrimTimeInput(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === '') {
    return null;
  }

  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const seconds = Number(trimmed);
    return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
  }

  const parts = trimmed.split(':');
  if (parts.length < 2 || parts.length > 3) {
    return null;
  }

  const parsed: number[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index] ?? '';
    const isLast = index === parts.length - 1;

    if (isLast && part.includes('.')) {
      const seconds = Number(part);
      if (!Number.isFinite(seconds) || seconds < 0) {
        return null;
      }
      parsed.push(seconds);
      continue;
    }

    if (!/^\d+$/.test(part)) {
      return null;
    }

    parsed.push(Number(part));
  }

  if (parts.length === 2) {
    const minutes = parsed[0] ?? 0;
    const seconds = parsed[1] ?? 0;
    if (seconds >= 60) {
      return null;
    }
    return minutes * 60 + seconds;
  }

  const hours = parsed[0] ?? 0;
  const minutes = parsed[1] ?? 0;
  const seconds = parsed[2] ?? 0;
  if (minutes >= 60 || seconds >= 60) {
    return null;
  }

  return hours * 3600 + minutes * 60 + seconds;
}
