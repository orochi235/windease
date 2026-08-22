import { describe, expect, it } from 'vitest';
import { createNode } from './constructors.js';
import { type LockSet, resolveLock, supportedAxes } from './lock.js';
import { asNodeId } from './node.js';

const id = (s: string) => asNodeId(s);

describe('supportedAxes', () => {
  it('gives a panel the membership axes plus the ungated ones', () => {
    const panel = createNode({
      kind: 'panel',
      focus: true,
      id: id('p'),
      parentId: id('z'),
    });
    expect([...supportedAxes(panel)].sort()).toEqual(['arrange', 'destroy', 'move', 'resize']);
  });

  it('gives a zone the container axes plus destroy, and no membership axes', () => {
    const zone = createNode({
      kind: 'zone',
      container: { strategyId: 'grid', config: {} },
      id: id('z'),
    });
    expect([...supportedAxes(zone)].sort()).toEqual(['accept', 'arrange', 'destroy', 'dragOut']);
  });

  it('gives a group every axis', () => {
    const group = createNode({
      kind: 'zone',
      container: { strategyId: 'grid', config: {} },
      id: id('g'),
      parentId: id('z'),
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
    const zone = createNode({
      kind: 'zone',
      container: { strategyId: 'grid', config: {} },
      id: id('z'),
    });
    expect(resolveLock(zone, true)).toEqual({
      accept: true,
      arrange: true,
      destroy: true,
      dragOut: true,
    });
  });

  it('drops unsupported axes instead of throwing', () => {
    const zone = createNode({
      kind: 'zone',
      container: { strategyId: 'grid', config: {} },
      id: id('z'),
    });
    expect(resolveLock(zone, { move: true, destroy: true })).toEqual({ destroy: true });
  });

  it('omits axes explicitly set false', () => {
    const panel = createNode({
      kind: 'panel',
      focus: true,
      id: id('p'),
      parentId: id('z'),
    });
    expect(resolveLock(panel, { move: true, resize: false })).toEqual({ move: true });
  });

  it('resolves false to an empty set', () => {
    const panel = createNode({
      kind: 'panel',
      focus: true,
      id: id('p'),
      parentId: id('z'),
    });
    expect(resolveLock(panel, false)).toEqual({});
  });

  it('drops a key that is not a real axis', () => {
    const panel = createNode({
      kind: 'panel',
      focus: true,
      id: id('p'),
      parentId: id('z'),
    });
    expect(resolveLock(panel, { bogus: true } as LockSet)).toEqual({});
  });
});
