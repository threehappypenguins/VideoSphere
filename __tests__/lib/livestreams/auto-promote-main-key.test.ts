import { describe, expect, it } from 'vitest';

import {
  AUTO_PROMOTE_TO_MAIN_KEY_MINUTE_OPTIONS,
  DEFAULT_AUTO_PROMOTE_TO_MAIN_KEY_MINUTES,
  formatAutoPromoteToMainKeyMinutesLabel,
  normalizeAutoPromoteToMainKeyMinutes,
  parseAutoPromoteToMainKeyFromRequestBody,
  parseAutoPromoteToMainKeyMinutesFromRequestBody,
  resolveAutoPromoteToMainKeyEnabled,
  resolveAutoPromoteToMainKeyMinutes,
} from '@/lib/livestreams/auto-promote-main-key';

describe('auto-promote-main-key helpers', () => {
  it('exposes 5-minute options from 5 through 60 minutes', () => {
    expect(AUTO_PROMOTE_TO_MAIN_KEY_MINUTE_OPTIONS).toEqual([
      5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60,
    ]);
  });

  it('defaults temp-slot promotion to enabled and 30 minutes', () => {
    expect(resolveAutoPromoteToMainKeyEnabled({ keySlot: 'temp' })).toBe(true);
    expect(resolveAutoPromoteToMainKeyMinutes({})).toBe(DEFAULT_AUTO_PROMOTE_TO_MAIN_KEY_MINUTES);
  });

  it('respects an explicit opt-out', () => {
    expect(
      resolveAutoPromoteToMainKeyEnabled({ keySlot: 'temp', autoPromoteToMainKey: false })
    ).toBe(false);
  });

  it('normalizes invalid stored minutes to the default', () => {
    expect(normalizeAutoPromoteToMainKeyMinutes(31)).toBe(DEFAULT_AUTO_PROMOTE_TO_MAIN_KEY_MINUTES);
    expect(normalizeAutoPromoteToMainKeyMinutes(45)).toBe(45);
  });

  it('parses request body fields', () => {
    expect(parseAutoPromoteToMainKeyFromRequestBody(true)).toEqual({ ok: true, value: true });
    expect(parseAutoPromoteToMainKeyMinutesFromRequestBody(20)).toEqual({ ok: true, value: 20 });
    expect(parseAutoPromoteToMainKeyMinutesFromRequestBody(31).ok).toBe(false);
  });

  it('formats labels for the UI dropdown', () => {
    expect(formatAutoPromoteToMainKeyMinutesLabel(30)).toBe('30 minutes before start');
    expect(formatAutoPromoteToMainKeyMinutesLabel(5)).toBe('5 minutes before start');
  });
});
