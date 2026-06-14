import { describe, expect, it } from 'vitest';
import {
  CapabilityMissingError,
  CycleError,
  DuplicateNodeError,
  InvariantViolationError,
  NodeNotFoundError,
  StrategyRejectionError,
  WindeaseError,
} from './errors.js';
import { asNodeId } from './node.js';

describe('WindeaseError', () => {
  it('carries code and message', () => {
    const e = new WindeaseError('UNKNOWN_WINDOW', 'no such id: x');
    expect(e.code).toBe('UNKNOWN_WINDOW');
    expect(e.message).toBe('no such id: x');
    expect(e.name).toBe('WindeaseError');
    expect(e instanceof Error).toBe(true);
  });
});

import { describe as describe2, expect as expect2, it as it2 } from 'vitest';

describe2('WindeaseError - workspace codes', () => {
  for (const code of ['WRONG_ITEM_COUNT', 'UNKNOWN_AFFORDANCE_KIND', 'NO_INITIAL_STATE'] as const) {
    it2(`carries ${code}`, () => {
      const e = new WindeaseError(code, `test ${code}`);
      expect2(e.code).toBe(code);
      expect2(e.message).toBe(`test ${code}`);
    });
  }
});

describe('error subclasses', () => {
  it('NodeNotFoundError carries the id and is a WindeaseError', () => {
    const err = new NodeNotFoundError(asNodeId('n1'));
    expect(err).toBeInstanceOf(WindeaseError);
    expect(err.code).toBe('unknown-node');
    expect(err.id).toBe('n1');
    expect(err.message).toContain('n1');
  });

  it('DuplicateNodeError carries the id', () => {
    const err = new DuplicateNodeError(asNodeId('n2'));
    expect(err.code).toBe('duplicate-id');
    expect(err.id).toBe('n2');
  });

  it('CapabilityMissingError carries id, capability, operation', () => {
    const err = new CapabilityMissingError(asNodeId('n4'), 'focus', 'focusNode');
    expect(err.code).toBe('capability-missing');
    expect(err.capability).toBe('focus');
    expect(err.operation).toBe('focusNode');
  });

  it('CycleError carries node and attempted parent', () => {
    const err = new CycleError(asNodeId('a'), asNodeId('b'));
    expect(err.code).toBe('cycle-detected');
    expect(err.nodeId).toBe('a');
    expect(err.attemptedParentId).toBe('b');
  });

  it('StrategyRejectionError carries parent id and optional reason', () => {
    const err = new StrategyRejectionError(asNodeId('p'), 'capacity exceeded');
    expect(err.code).toBe('strategy-rejected');
    expect(err.parentId).toBe('p');
    expect(err.reason).toBe('capacity exceeded');
  });

  it('InvariantViolationError carries code and context', () => {
    const err = new InvariantViolationError('orphan-child', 'no parent', { id: 'n5' });
    expect(err.code).toBe('orphan-child');
    expect(err.context).toEqual({ id: 'n5' });
  });
});
