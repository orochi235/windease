import { describe, expect, it } from 'vitest';
import { createPanel } from './constructors.js';
import { asNodeId } from './node.js';

describe('NodeHints.maxSize', () => {
  it('round-trips maxSize via createPanel hints', () => {
    const node = createPanel({
      id: asNodeId('p'),
      parentId: asNodeId('parent'),
      hints: { minSize: { w: 10, h: 10 }, maxSize: { w: 200, h: 300 } },
    });
    expect(node.hints?.maxSize).toEqual({ w: 200, h: 300 });
  });

  it('accepts placement.size on creation', () => {
    const node = createPanel({
      id: asNodeId('p'),
      parentId: asNodeId('parent'),
      placement: { size: { h: 180 } },
    });
    expect((node.slot?.placement as Record<string, unknown>).size).toEqual({ h: 180 });
  });
});
