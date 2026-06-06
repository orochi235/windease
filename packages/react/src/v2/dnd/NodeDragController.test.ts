import {
  asNodeId,
  createPanel,
  createZone,
  WindeaseNodeStore,
} from '@windease/core';
import { describe, expect, it, vi } from 'vitest';
import { NodeDragController } from './NodeDragController.js';

function buildStore(): WindeaseNodeStore {
  const s = new WindeaseNodeStore();
  s.registerNode(createZone({ id: asNodeId('z1'), strategyId: 'stack', config: {} }));
  s.registerNode(createZone({ id: asNodeId('z2'), strategyId: 'stack', config: {} }));
  s.registerNode(createPanel({ id: asNodeId('p'), parentId: asNodeId('z1') }));
  return s;
}

describe('NodeDragController', () => {
  it('tryBegin succeeds for a slotted unlocked node', () => {
    const s = buildStore();
    const c = new NodeDragController(s);
    expect(c.tryBegin(asNodeId('p'))).toBe(true);
    expect(c.state()?.draggingId).toBe('p');
  });

  it('tryBegin returns false for locked node', () => {
    const s = buildStore();
    s.patchPlacement(asNodeId('p'), { locked: true });
    const c = new NodeDragController(s);
    expect(c.tryBegin(asNodeId('p'))).toBe(false);
  });

  it('tryBegin returns false for unslotted (root) node', () => {
    const s = buildStore();
    const c = new NodeDragController(s);
    expect(c.tryBegin(asNodeId('z1'))).toBe(false);
  });

  it('drop moves the node to the hovered accepted target', () => {
    const s = buildStore();
    const c = new NodeDragController(s);
    c.tryBegin(asNodeId('p'));
    // Simulate a drop target rect at known coords
    const fake = makeFakeElement(0, 0, 100, 100);
    c.registerDropTarget(asNodeId('z2'), fake);
    c.updateHoverByPoint(50, 50);
    expect(c.state()?.hover?.targetId).toBe('z2');
    c.drop();
    expect(s.getContainerView(asNodeId('z2'))?.childIds).toEqual(['p']);
    expect(c.state()).toBeNull();
  });

  it('cancel clears state without moving', () => {
    const s = buildStore();
    const c = new NodeDragController(s);
    c.tryBegin(asNodeId('p'));
    c.cancel('outside');
    expect(c.state()).toBeNull();
    expect(s.getContainerView(asNodeId('z1'))?.childIds).toEqual(['p']);
  });

  it('subscribers fire on state change', () => {
    const s = buildStore();
    const c = new NodeDragController(s);
    const fn = vi.fn();
    c.subscribe(fn);
    c.tryBegin(asNodeId('p'));
    expect(fn).toHaveBeenCalled();
  });
});

function makeFakeElement(x: number, y: number, w: number, h: number): Element {
  return {
    getBoundingClientRect: () => ({
      left: x,
      top: y,
      right: x + w,
      bottom: y + h,
      width: w,
      height: h,
      x,
      y,
      toJSON: () => ({}),
    }),
    parentElement: null,
  } as unknown as Element;
}
