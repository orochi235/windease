import { describe, expect, it } from 'vitest';
import { createGroup, createPanel, createZone } from './constructors.js';
import { type LockSet, resolveLock, supportedAxes } from './lock.js';
import { asNodeId } from './node.js';

const id = (s: string) => asNodeId(s);

describe('supportedAxes', () => {
  it('gives a panel the membership axes plus destroy', () => {
    const panel = createPanel({ id: id('p'), parentId: id('z') });
    expect([...supportedAxes(panel)].sort()).toEqual(['destroy', 'move', 'resize']);
  });

  it('gives a zone the container axes plus destroy, and no membership axes', () => {
    const zone = createZone({ id: id('z'), strategyId: 'grid', config: {} });
    expect([...supportedAxes(zone)].sort()).toEqual(['accept', 'arrange', 'destroy', 'dragOut']);
  });

  it('gives a group every axis', () => {
    const group = createGroup({
      id: id('g'),
      parentId: id('z'),
      strategyId: 'grid',
      config: {},
    });
    expect([...supportedAxes(group)].sort()).toEqual([
      'accept',
      'arrange',
      'destroy',
      'dragOut',
      'move',
      'resize',
    ]);
  });
});

describe('resolveLock', () => {
  it('expands true to every supported axis', () => {
    const zone = createZone({ id: id('z'), strategyId: 'grid', config: {} });
    expect(resolveLock(zone, true)).toEqual({
      accept: true,
      arrange: true,
      destroy: true,
      dragOut: true,
    });
  });

  it('drops unsupported axes instead of throwing', () => {
    const zone = createZone({ id: id('z'), strategyId: 'grid', config: {} });
    expect(resolveLock(zone, { move: true, destroy: true })).toEqual({ destroy: true });
  });

  it('omits axes explicitly set false', () => {
    const panel = createPanel({ id: id('p'), parentId: id('z') });
    expect(resolveLock(panel, { move: true, resize: false })).toEqual({ move: true });
  });

  it('resolves false to an empty set', () => {
    const panel = createPanel({ id: id('p'), parentId: id('z') });
    expect(resolveLock(panel, false)).toEqual({});
  });

  it('drops a key that is not a real axis', () => {
    const panel = createPanel({ id: id('p'), parentId: id('z') });
    expect(resolveLock(panel, { bogus: true } as LockSet)).toEqual({});
  });
});
