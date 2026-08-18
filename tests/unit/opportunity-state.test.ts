import { describe, expect, it } from 'vitest';
import {
  ACTIVE_STATES,
  OPPORTUNITY_STATE_KEYS,
  allowedTransitions,
  canTransition,
  evaluateTransition,
  type OpportunityState,
} from '../../src/domain/state/opportunity-state';

describe('opportunity state machine', () => {
  it('declares transitions for every state, exhaustively', () => {
    for (const state of OPPORTUNITY_STATE_KEYS) {
      expect(allowedTransitions(state)).toBeDefined();
    }
  });

  it('rejects every transition that is not explicitly allowed', () => {
    for (const from of OPPORTUNITY_STATE_KEYS) {
      for (const to of OPPORTUNITY_STATE_KEYS) {
        const allowed = allowedTransitions(from).includes(to);
        expect(canTransition(from, to)).toBe(allowed);
      }
    }
  });

  it('never allows a state to transition to itself', () => {
    for (const state of OPPORTUNITY_STATE_KEYS) {
      expect(canTransition(state, state)).toBe(false);
    }
  });

  /**
   * The central guarantee of the product: nothing reaches execution without
   * having been investigated and validated first.
   */
  it('has no path to execution that skips validation', () => {
    for (const from of OPPORTUNITY_STATE_KEYS) {
      if (from === 'validated') continue;
      expect(canTransition(from, 'execution')).toBe(false);
    }
  });

  it('has no path from a bare detection to a candidate', () => {
    expect(canTransition('detected', 'candidate')).toBe(false);
    expect(canTransition('watching', 'candidate')).toBe(false);
  });

  it('always allows rejection from any live state', () => {
    for (const state of ACTIVE_STATES) {
      expect(canTransition(state, 'rejected')).toBe(true);
    }
  });

  it('keeps rejected opportunities reopenable rather than lost', () => {
    expect(canTransition('rejected', 'reopened')).toBe(true);
    expect(canTransition('archived', 'reopened')).toBe(true);
  });
});

describe('transition rules', () => {
  const request = (over: Partial<Parameters<typeof evaluateTransition>[0]> = {}) =>
    evaluateTransition({
      from: 'watching' as OpportunityState,
      to: 'investigating' as OpportunityState,
      reason: 'Three independent spending signals appeared.',
      actorKind: 'user',
      ...over,
    });

  it('accepts a legal, explained transition', () => {
    expect(request()).toEqual({ ok: true });
  });

  it('refuses a state change with no stated reason', () => {
    expect(request({ reason: '   ' })).toMatchObject({ ok: false, code: 'reason_required' });
  });

  it('explains what would have been allowed instead', () => {
    const verdict = request({ from: 'detected', to: 'execution' });
    expect(verdict).toMatchObject({ ok: false, code: 'illegal_transition' });
    if (!verdict.ok) expect(verdict.message).toContain('watching');
  });

  it('will not let automation commit resources on the owner behalf', () => {
    for (const actorKind of ['system', 'job'] as const) {
      expect(
        evaluateTransition({
          from: 'validated',
          to: 'execution',
          reason: 'Scores crossed the threshold.',
          actorKind,
        }),
      ).toMatchObject({ ok: false, code: 'requires_human' });
    }
  });

  it('lets automation do the analytical work it is meant to do', () => {
    expect(
      evaluateTransition({
        from: 'watching',
        to: 'investigating',
        reason: 'Independent evidence crossed the investigation threshold.',
        actorKind: 'system',
      }),
    ).toEqual({ ok: true });
  });
});
