import { describe, expect, it } from 'vitest';
import { type ConfigSpec, checkStrategyConfig } from './config-check.js';

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
