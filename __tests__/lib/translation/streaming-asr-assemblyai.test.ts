import { describe, expect, it } from 'vitest';
import {
  applyAssemblyaiTranscript,
  assemblyaiTurnKind,
} from '@/lib/translation/streaming-asr/assemblyai';

describe('assemblyaiTurnKind', () => {
  it('treats in-progress turns as partials', () => {
    expect(assemblyaiTurnKind({ end_of_turn: false })).toBe('partial');
    expect(assemblyaiTurnKind({})).toBe('partial');
  });

  it('waits for the formatted end_of_turn when format_turns is on', () => {
    expect(assemblyaiTurnKind({ end_of_turn: true, turn_is_formatted: false })).toBe('partial');
    expect(assemblyaiTurnKind({ end_of_turn: true, turn_is_formatted: true })).toBe('final');
  });

  it('treats end_of_turn alone as final when formatting is not reported', () => {
    expect(assemblyaiTurnKind({ end_of_turn: true })).toBe('final');
  });
});

describe('applyAssemblyaiTranscript', () => {
  it('soft-splits a long cumulative turn into sentence-sized finals', () => {
    const text =
      'And when he requested, they set food before him and he ate. Then his servants said to him, what is this you have done? You fasted and wept for the child while he was alive, but when the child died, you arose and ate.';
    const result = applyAssemblyaiTranscript({
      kind: 'partial',
      text,
      finalizedPrefix: '',
      sourceLanguage: 'en',
    });
    const finals = result.events.filter((e) => e.kind === 'final');
    expect(finals.length).toBeGreaterThan(1);
    expect(finals.every((e) => e.kind === 'final' && e.text.length <= 200)).toBe(true);
  });

  it('does not re-emit already finalized prefix on later partials', () => {
    const first =
      'Why should I fast? Can I bring him back again? I shall go to him, but he shall not return to me.';
    const step1 = applyAssemblyaiTranscript({
      kind: 'partial',
      text: first,
      finalizedPrefix: '',
      sourceLanguage: 'en',
    });
    const finals1 = step1.events.filter((e) => e.kind === 'final').map((e) => e.text);
    expect(finals1.length).toBeGreaterThan(0);

    const step2 = applyAssemblyaiTranscript({
      kind: 'partial',
      text: `${first} Then David comforted Bathsheba his wife.`,
      finalizedPrefix: step1.finalizedPrefix,
      sourceLanguage: 'en',
    });
    for (const f of finals1) {
      expect(step2.events.filter((e) => e.kind === 'final').map((e) => e.text)).not.toContain(f);
    }
  });

  it('flushes remainder on formatted provider final', () => {
    const result = applyAssemblyaiTranscript({
      kind: 'final',
      text: 'Short leftover clause without a period yet',
      finalizedPrefix: 'Earlier sentence already spoken.',
      sourceLanguage: 'en',
    });
    expect(result.finalizedPrefix).toBe('');
    expect(result.events).toEqual([
      {
        kind: 'final',
        text: 'Short leftover clause without a period yet',
        language: 'en',
      },
    ]);
  });
});
