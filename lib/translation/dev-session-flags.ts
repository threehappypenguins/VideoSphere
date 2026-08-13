/**
 * Client storage keys for translation owner capture UI.
 * - sessionStorage: survive remounts during live ingest (Strict Mode / occasional HMR).
 * - localStorage: remember the last audio input across new browser sessions.
 */

/** Owner dashboard: Add audio is intentionally live and should auto-resume. */
export const TRANSLATION_INGEST_INTENT_KEY = 'videosphere.translation.ingestIntent';

/** Last selected audio input device id (survives new tabs / sessions). */
export const TRANSLATION_PREFERRED_AUDIO_INPUT_KEY = 'videosphere.translation.preferredAudioInput';
