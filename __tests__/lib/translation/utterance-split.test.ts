import { describe, expect, it } from 'vitest';
import {
  applyCumulativeUtteranceTranscript,
  looksLikeIncompleteCaption,
  takeUtteranceChunk,
} from '@/lib/translation/streaming-asr/utterance-split';

describe('takeUtteranceChunk', () => {
  it('does not hard-break mid-phrase while still under hard max on partials', () => {
    const long =
      'God for hearing the afflict the afflicted one and not that he did not despise the affliction of the afflicted one';
    expect(takeUtteranceChunk(long, 90, 140, { allowHardBreak: false })).toBeNull();
  });

  it('splits at a late sentence end past hard max on partials', () => {
    const text =
      'the husband home and uh tried to get him to be with his wife and he said he would not because his fellow soldiers were there on the battlefield and he would not feel right about that. And then David sent him back anyway.';
    const split = takeUtteranceChunk(text, 90, 140, { allowHardBreak: false });
    expect(split).not.toBeNull();
    expect(split!.chunk).toMatch(/feel right about that\.$/);
    expect(split!.rest).toMatch(/^And then David/i);
  });

  it('forces a clause break on partials once past hard max with no period', () => {
    const words = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ');
    expect(words.length).toBeGreaterThan(140);
    const split = takeUtteranceChunk(words, 90, 140, { allowHardBreak: false });
    expect(split).not.toBeNull();
    expect(split!.chunk.length).toBeLessThanOrEqual(140);
    expect(split!.rest.length).toBeGreaterThan(0);
  });

  it('rejects incomplete caption endings when splitting', () => {
    const text =
      'God for hearing the afflict— And then something else that keeps going past the soft max length here.';
    const split = takeUtteranceChunk(text, 40, 200, { allowHardBreak: true });
    if (split) {
      expect(looksLikeIncompleteCaption(split.chunk)).toBe(false);
    }
  });
});

describe('applyCumulativeUtteranceTranscript revisions', () => {
  it('does not re-emit when the provider drops a mid-turn period and continues the sentence', () => {
    const locked = 'Redemption to the world was already made, and David.';
    const step2 = applyCumulativeUtteranceTranscript({
      kind: 'partial',
      text: 'Redemption to the world was already made, and David had trusted that.',
      finalizedPrefix: locked,
      sourceLanguage: 'en',
    });

    const finals2 = step2.events.filter((e) => e.kind === 'final').map((e) => e.text);
    expect(finals2.some((t) => /Redemption to the world was already made/i.test(t))).toBe(false);
    expect(step2.events.some((e) => e.kind === 'partial')).toBe(true);
    const partial = step2.events.find((e) => e.kind === 'partial');
    expect(partial && partial.kind === 'partial' ? partial.text : '').toMatch(/had trusted that/i);
  });

  it('does not reset and duplicate when punctuation/dashes are revised', () => {
    const locked =
      'redemption to the world was already made, and David had trusted that from his— perhaps as far back as he could remember.';
    const revised =
      'Redemption to the world was already made, and David had trusted that from his perhaps as far back as he could remember.';

    const result = applyCumulativeUtteranceTranscript({
      kind: 'partial',
      text: revised,
      finalizedPrefix: locked,
      sourceLanguage: 'en',
    });

    const finals = result.events.filter((e) => e.kind === 'final');
    expect(finals).toEqual([]);
    expect(
      result.events.every((e) => e.kind !== 'final' || !/Redemption to the world/i.test(e.text))
    ).toBe(true);
  });

  it('continues with only the new tail after a word-aligned prefix', () => {
    const locked = 'Redemption to the world was already made, and David.';
    const growing =
      'Redemption to the world was already made, and David had trusted that from his youth. And now we look further into the next part of the psalm today.';

    const result = applyCumulativeUtteranceTranscript({
      kind: 'partial',
      text: growing,
      finalizedPrefix: locked,
      sourceLanguage: 'en',
    });

    const finals = result.events.filter((e) => e.kind === 'final').map((e) => e.text);
    expect(finals.some((t) => /^Redemption to the world/i.test(t))).toBe(false);
    // First completed sentence after the lock becomes a final; remainder stays partial.
    expect(finals.join(' ')).toMatch(/had trusted that from his youth/i);
    const partial = result.events.find((e) => e.kind === 'partial');
    expect(partial && partial.kind === 'partial' ? partial.text : '').toMatch(/look further/i);
  });

  it('soft-splits a new utterance instead of dumping one giant final', () => {
    const previous = "They don't think he's a merciful God. They think he's cruel.";
    const nextTurn =
      "hard thoughts about God. They don't think he's a merciful God. They think he's cruel. They look at all the troubles in the world he has brought because of our sin. They say that he is cruel and unjust, when in fact all those troubles are an expression of God's very justice and purity, that He does not tolerate sin. That's why He does not let us go on living in a world filled with sin without bringing such consequences to us. Reconciliation with God brings everything under the light of truth.";

    const result = applyCumulativeUtteranceTranscript({
      kind: 'final',
      text: nextTurn,
      finalizedPrefix: previous,
      sourceLanguage: 'en',
    });

    const finals = result.events.filter((e) => e.kind === 'final');
    expect(finals.length).toBeGreaterThan(2);
    expect(finals.every((e) => e.kind === 'final' && e.text.length <= 200)).toBe(true);
  });

  it('does not recombine already-finalized text into a growing partial on align failure', () => {
    // Same turn (opening words match) but mid-turn revision breaks word alignment.
    // Whatever we emit must not replay the locked caption as a growing partial.
    const locked = 'Alpha beta gamma uniqueFinalWordXYZ and more locked caption text about David.';
    const revised =
      'Alpha beta gamma something completely different without that marker going on for a long time with many words here about mercy and grace in this psalm.';

    const result = applyCumulativeUtteranceTranscript({
      kind: 'partial',
      text: revised,
      finalizedPrefix: locked,
      sourceLanguage: 'en',
    });

    for (const e of result.events) {
      if (e.kind !== 'final' && e.kind !== 'partial') continue;
      expect(e.text).not.toMatch(/uniqueFinalWordXYZ/i);
      expect(e.text.toLowerCase().startsWith('alpha beta gamma unique')).toBe(false);
    }
  });

  it('keeps mid-turn partials as one growing remainder without eager short finals', () => {
    const text =
      'And then the whole psalm changes its tone for the last third of it, from verse, uh, 21 on.';
    const result = applyCumulativeUtteranceTranscript({
      kind: 'partial',
      text,
      finalizedPrefix: '',
      sourceLanguage: 'en',
    });

    // Under soft max / no clean sentence past soft — stay as partial, do not chop on "uh,".
    expect(result.events.filter((e) => e.kind === 'final')).toEqual([]);
    expect(result.events.some((e) => e.kind === 'partial')).toBe(true);
  });

  it('soft-splits a long mid-turn preaching run-on instead of one growing blurb', () => {
    const text =
      "the husband home and, uh, tried to, uh, get him to be with his wife, and he said he wouldn't because his, his, uh, fellow, uh, soldiers were there on the battlefield, and he wouldn't— didn't feel right about that. And he Um, he went back— David sent him back to the battlefield with orders to the leader to, uh— he didn't, uh, the man didn't know that. Uriah was his name, but he sent orders to put him in danger so that He would die on the battlefield, and he did. And David was trying to cover up his sin. He did not repent. It was unlike David.";

    const result = applyCumulativeUtteranceTranscript({
      kind: 'partial',
      text,
      finalizedPrefix: '',
      sourceLanguage: 'en',
    });

    const finals = result.events.filter((e) => e.kind === 'final');
    expect(finals.length).toBeGreaterThanOrEqual(2);
    expect(finals.every((e) => e.kind === 'final' && e.text.length <= 200)).toBe(true);
    const partial = result.events.find((e) => e.kind === 'partial');
    // Remaining partial must be short — not the whole sermon again.
    if (partial && partial.kind === 'partial') {
      expect(partial.text.length).toBeLessThan(text.length / 2);
    }
  });

  it('does not re-emit when ASR revises Verse/can wording in an already-finalized caption', () => {
    const locked = "Verse 13 to 25. Now there's a lot that we can focus on.";
    const revisions = [
      "13 to 25. Now there's a lot that we can focus on. Look at David's true sense of mercy in this passage today.",
      "Verse 13 to 25. Now there's a lot that we could focus on. Look at David's true sense of mercy in this passage today.",
      "Now there's a lot that we could focus on. Look at David's true sense of mercy in this passage today.",
      "Verses 13 to 25. Now there's a lot that we could focus on. Look at David's true sense of mercy in this passage today.",
    ];

    let prefix = locked;
    for (const text of revisions) {
      const result = applyCumulativeUtteranceTranscript({
        kind: 'partial',
        text,
        finalizedPrefix: prefix,
        sourceLanguage: 'en',
      });
      const finals = result.events.filter((e) => e.kind === 'final').map((e) => e.text);
      expect(finals.some((t) => /13 to 25/i.test(t))).toBe(false);
      expect(finals.some((t) => /lot that we (can|could) focus/i.test(t))).toBe(false);
      prefix = result.finalizedPrefix;
    }
  });
});
