import { describe, expect, it } from 'vitest';
import { pickKey, type RotationCandidate } from './keys';

const candidate = (id: string, overrides: Partial<RotationCandidate> = {}): RotationCandidate => ({
  id,
  weight: 1,
  activeSessions: 0,
  usageCount: 0,
  lastUsedAt: null,
  ...overrides,
});

const sequence = (candidates: RotationCandidate[], picks: number) => {
  const state = new Map<string, number>();
  return Array.from({ length: picks }, () => pickKey('round_robin', candidates, state)?.id);
};

describe('pickKey', () => {
  it('round_robin alternates evenly and respects weights (smooth weighted round robin)', () => {
    expect(sequence([candidate('a'), candidate('b'), candidate('c')], 6)).toEqual(['a', 'b', 'c', 'a', 'b', 'c']);
    expect(sequence([candidate('a'), candidate('b', { weight: 2 })], 6)).toEqual(['b', 'a', 'b', 'b', 'a', 'b']);
    const counts = sequence([candidate('a', { weight: 1 }), candidate('b', { weight: 3 })], 40).reduce<Record<string, number>>(
      (acc, id) => ({ ...acc, [id ?? '']: (acc[id ?? ''] ?? 0) + 1 }),
      {},
    );
    expect(counts).toEqual({ a: 10, b: 30 });
  });

  it('round_robin forgets keys that left the rotation', () => {
    const state = new Map<string, number>();
    const a = candidate('a');
    const b = candidate('b');
    expect(pickKey('round_robin', [a, b], state)?.id).toBe('a');
    expect(pickKey('round_robin', [b], state)?.id).toBe('b');
    expect(state.has('a')).toBe(false);
  });

  it('random picks proportionally to weight', () => {
    const keys = [candidate('a', { weight: 1 }), candidate('b', { weight: 3 })];
    const state = new Map<string, number>();
    expect(pickKey('random', keys, state, () => 0.2)?.id).toBe('a');
    expect(pickKey('random', keys, state, () => 0.3)?.id).toBe('b');
    expect(pickKey('random', keys, state, () => 0.99)?.id).toBe('b');
  });

  it('least_used prefers the fewest bound sessions per weight, then calls, then the oldest use', () => {
    const state = new Map<string, number>();
    expect(
      pickKey('least_used', [candidate('a', { activeSessions: 2 }), candidate('b', { activeSessions: 3, weight: 2 })], state)?.id,
    ).toBe('b');
    expect(pickKey('least_used', [candidate('a', { usageCount: 5 }), candidate('b', { usageCount: 2 })], state)?.id).toBe('b');
    expect(
      pickKey(
        'least_used',
        [candidate('a', { lastUsedAt: new Date(2_000) }), candidate('b', { lastUsedAt: new Date(1_000) })],
        state,
      )?.id,
    ).toBe('b');
    expect(pickKey('least_used', [candidate('a'), candidate('b')], state)?.id).toBe('a');
  });

  it('returns null without candidates', () => {
    expect(pickKey('round_robin', [], new Map())).toBeNull();
  });
});
