import { describe, expect, it } from 'vitest';
import { type ConfigConflict, type ConfigSpec, checkStrategyConfig } from './config-check.js';

const SPEC: ConfigSpec = {
  axis: ['x', 'y'],
  gap: 'number',
  fill: 'boolean',
  label: 'string',
};

describe('checkStrategyConfig', () => {
  it('says nothing about a config that matches', () => {
    expect(checkStrategyConfig('strip', { axis: 'y', gap: 8, fill: true }, SPEC)).toEqual([]);
  });

  it('accepts an empty config, since every key is optional', () => {
    expect(checkStrategyConfig('strip', {}, SPEC)).toEqual([]);
  });

  it('names an unknown key and the nearest real one', () => {
    const [problem] = checkStrategyConfig('strip', { axl: 'y' }, SPEC);
    expect(problem).toContain('axl');
    expect(problem).toContain('axis');
  });

  it('names an unknown key with no near match without guessing', () => {
    const [problem] = checkStrategyConfig('strip', { wobble: 1 }, SPEC);
    expect(problem).toContain('wobble');
    expect(problem).not.toContain('did you mean');
  });

  it('catches a value outside an enum', () => {
    const [problem] = checkStrategyConfig('strip', { axis: 'z' }, SPEC);
    expect(problem).toContain('axis');
    expect(problem).toContain("'x' | 'y'");
  });

  it('catches a wrong primitive type', () => {
    const [problem] = checkStrategyConfig('strip', { gap: '8' }, SPEC);
    expect(problem).toContain('gap');
    expect(problem).toContain('number');
    expect(problem).toContain('string');
  });

  it('treats undefined as absent rather than as a wrong type', () => {
    expect(checkStrategyConfig('strip', { gap: undefined }, SPEC)).toEqual([]);
  });

  it('reports every problem, not just the first', () => {
    expect(checkStrategyConfig('strip', { axl: 1, gap: '8', axis: 'z' }, SPEC)).toHaveLength(3);
  });

  it('is quiet on a null or non-object config', () => {
    expect(checkStrategyConfig('strip', null, SPEC)).toEqual([]);
    expect(checkStrategyConfig('strip', 7, SPEC)).toEqual([]);
  });
});

const CONFLICTS: readonly ConfigConflict[] = [
  { kind: 'exclusive', keys: ['gap', 'fill'] },
  { kind: 'ignored', key: 'label', when: ['axis', 'gap'] },
];

describe('checkStrategyConfig — conflicting keys', () => {
  it('says nothing when only one of an exclusive pair is set', () => {
    expect(checkStrategyConfig('strip', { gap: 8 }, SPEC, CONFLICTS)).toEqual([]);
  });

  it('names both members of an exclusive pair that are set together', () => {
    const [problem] = checkStrategyConfig('strip', { gap: 8, fill: true }, SPEC, CONFLICTS);
    expect(problem).toContain('mutually exclusive');
    expect(problem).toContain("'gap'");
    expect(problem).toContain("'fill'");
  });

  it('reports a key the config makes irrelevant, naming what shadowed it', () => {
    const [problem] = checkStrategyConfig('strip', { label: 'x', axis: 'y' }, SPEC, CONFLICTS);
    expect(problem).toContain("'label' is ignored when 'axis' is set");
  });

  it('names every key that shadowed it, not just the first', () => {
    const [problem] = checkStrategyConfig(
      'strip',
      { label: 'x', axis: 'y', gap: 4 },
      SPEC,
      CONFLICTS,
    );
    expect(problem).toContain("'axis' and 'gap'");
  });

  it('stays quiet about an ignored key that was never set', () => {
    expect(checkStrategyConfig('strip', { axis: 'y' }, SPEC, CONFLICTS)).toEqual([]);
  });

  it('treats an explicit undefined as absent on both sides of a conflict', () => {
    expect(
      checkStrategyConfig(
        'strip',
        { gap: undefined, fill: true, label: undefined },
        SPEC,
        CONFLICTS,
      ),
    ).toEqual([]);
  });

  it('checks nothing extra when a strategy declares no conflicts', () => {
    expect(checkStrategyConfig('strip', { gap: 8, fill: true }, SPEC)).toEqual([]);
  });
});
