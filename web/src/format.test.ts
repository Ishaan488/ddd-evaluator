import { describe, expect, it } from 'vitest';
import { formatDuration, formatScore, location, shortHash, timeAgo } from './format';

describe('formatting', () => {
  it('shows scores to one decimal and dashes for no score', () => {
    expect(formatScore(87.5)).toBe('87.5');
    expect(formatScore(90)).toBe('90.0');
    expect(formatScore(null)).toBe('—');
    expect(formatScore(undefined)).toBe('—');
  });

  it('says how long ago something happened', () => {
    const now = new Date('2026-10-22T12:00:00Z').getTime();
    expect(timeAgo('2026-10-22T11:59:40Z', now)).toBe('just now');
    expect(timeAgo('2026-10-22T11:30:00Z', now)).toBe('30 min ago');
    expect(timeAgo('2026-10-22T09:00:00Z', now)).toBe('3 h ago');
    expect(timeAgo('2026-10-20T12:00:00Z', now)).toBe('2 d ago');
    expect(timeAgo(null)).toBe('—');
  });

  it('formats durations, hashes and cell locations', () => {
    expect(formatDuration(850)).toBe('850 ms');
    expect(formatDuration(2500)).toBe('2.5 s');
    expect(formatDuration(null)).toBe('—');
    expect(shortHash('462af9f35d4cef35b519')).toBe('462af9f35d');
    expect(location({ sheet: 'Tree', cell: 'L121' })).toBe('Tree!L121');
    expect(location(null)).toBe('—');
  });
});
