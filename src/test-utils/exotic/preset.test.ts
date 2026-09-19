import { describe, expect, it } from 'vitest';
import { asNodeId } from '../../node.js';
import {
  type Preset,
  presetProperties,
  presetScenario,
  presetToStore,
  presetTree,
  styled,
} from './preset.js';

const PRESET: Preset = {
  id: 'tiny',
  source: 'test',
  stress: 'none',
  description: 'test',
  viewport: { w: 300, h: 200 },
  mechanics: {
    id: 'root',
    strategy: 'strip',
    config: { axis: 'x' },
    children: [
      { id: 'a', placement: { size: { w: 100 } } },
      { id: 'inner', strategy: 'stack', children: [{ id: 'b' }, { id: 'c', hidden: true }] },
    ],
  },
};

describe('presets', () => {
  it('builds the tree into a store with containers, membership and visibility', () => {
    const store = presetToStore(PRESET);
    expect(store.getNode(asNodeId('root'))?.container?.childOrder).toEqual(['a', 'inner']);
    expect(store.getNode(asNodeId('b'))?.membership?.parentId).toBe('inner');
    expect(store.getNode(asNodeId('inner'))?.container?.strategyId).toBe('stack');
  });

  it('projects one container into a flat scenario', () => {
    const s = presetScenario(PRESET);
    expect(s.items.map((i) => i.id)).toEqual(['a', 'inner']);
    expect(s.items[0]?.placement?.size).toEqual({ w: 100 });
    expect(s.options).toEqual({ axis: 'x' });
    expect(presetScenario(PRESET, 'inner').id).toBe('tiny/inner');
  });

  it('rejects a duplicate id', () => {
    const dup: Preset = {
      ...PRESET,
      mechanics: { id: 'r', strategy: 'strip', children: [{ id: 'x' }, { id: 'x' }] },
    };
    expect(() => presetToStore(dup)).toThrow(/duplicate/);
  });
});

describe('preset state and visibility', () => {
  const withState: Preset = {
    id: 's',
    source: 'test',
    stress: 'none',
    description: 'test',
    viewport: { w: 100, h: 100 },
    mechanics: {
      id: 'root',
      strategy: 'floating',
      state: { positions: { a: { x: 5, y: 6 } } },
      children: [{ id: 'a' }, { id: 'b', hidden: true }],
    },
  };

  it('writes container state and carries it into the scenario', () => {
    expect(presetToStore(withState).getContainerState(asNodeId('root'))).toEqual({
      positions: { a: { x: 5, y: 6 } },
    });
    expect(presetScenario(withState).state).toEqual({ positions: { a: { x: 5, y: 6 } } });
  });

  it('leaves hidden children out of the scenario', () => {
    expect(presetScenario(withState).items.map((i) => i.id)).toEqual(['a']);
  });
});

describe('presetProperties', () => {
  it('reads the viewport, node counts, strategies with config, and features in use', () => {
    expect(presetProperties(PRESET)).toEqual([
      { label: 'Viewport', value: '300 × 200' },
      { label: 'Nodes', value: '5 (2 containers, 3 panes), 3 levels deep' },
      { label: 'Strategy: strip', value: '1 container — axis x' },
      { label: 'Strategy: stack', value: '1 container' },
      { label: 'placement.size', value: '1 node' },
      { label: 'Hidden', value: '1 node' },
    ]);
  });
});

describe('presetTree', () => {
  const split: Preset = {
    ...PRESET,
    mechanics: {
      id: 'root',
      strategy: 'strip',
      config: { axis: 'x' },
      children: [
        { id: 'a', meta: { spacer: false }, hints: { minSize: { w: 10, h: 0 } } },
        { id: 'inner', strategy: 'stack', children: [{ id: 'b' }] },
      ],
    },
    data: {
      nodes: {
        a: {
          meta: { title: 'A' },
          hints: { preferredSize: { w: 50, h: 20 } },
          className: 'product-a',
        },
        c: { meta: { title: 'C' } },
      },
      children: { inner: [{ id: 'c' }, { id: 'd' }] },
    },
  };

  it('merges meta, preferredSize and className onto the node, keeping what mechanics set', () => {
    const a = presetTree(split).children?.[0];
    expect(a?.meta).toEqual({ spacer: false, title: 'A', className: 'product-a' });
    expect(a?.hints).toEqual({ minSize: { w: 10, h: 0 }, preferredSize: { w: 50, h: 20 } });
  });

  it('appends data children after the container’s own, and merges data onto them too', () => {
    const inner = presetTree(split).children?.[1];
    expect(inner?.children?.map((c) => c.id)).toEqual(['b', 'c', 'd']);
    expect(inner?.children?.[1]?.meta).toEqual({ title: 'C' });
    expect(presetToStore(split).getNode(asNodeId('inner'))?.container?.childOrder).toEqual([
      'b',
      'c',
      'd',
    ]);
  });

  it('leaves the mechanics untouched', () => {
    presetTree(split);
    expect(split.mechanics.children?.[0]?.meta).toEqual({ spacer: false });
    expect(split.mechanics.children?.[1]?.children).toHaveLength(1);
  });

  it('throws on a data key naming no node, with the preset and the id', () => {
    expect(() => presetTree({ ...split, data: { nodes: { ghost: { meta: {} } } } })).toThrow(
      'preset tiny: data.nodes names unknown node ghost',
    );
    expect(() => presetTree({ ...split, data: { children: { ghost: [{ id: 'x' }] } } })).toThrow(
      'preset tiny: data.children names unknown node ghost',
    );
  });

  it('throws when data children target a node that is not a container', () => {
    expect(() => presetTree({ ...split, data: { children: { a: [{ id: 'x' }] } } })).toThrow(
      /preset tiny: data.children names a, which is not a container/,
    );
  });
});

describe('item templates', () => {
  const panes: Preset = {
    id: 'tmux-ish',
    source: 'test',
    stress: 'none',
    description: 'test',
    viewport: { w: 400, h: 100 },
    mechanics: {
      id: 'row',
      strategy: 'strip',
      item: { hints: { minSize: { w: 8, h: 0 } }, placement: { size: { w: 50 } } },
      children: [{ id: 'fixed' }],
    },
    data: {
      children: {
        row: [
          { id: 'a', meta: { title: 'A' } },
          { id: 'b', placement: { size: { w: 120 }, pinned: 0 } },
        ],
      },
    },
  };

  it('gives every data child the container template, the child winning key by key', () => {
    const [fixed, a, b] = presetTree(panes).children ?? [];
    expect(fixed).toEqual({ id: 'fixed' });
    expect(a).toEqual({
      id: 'a',
      meta: { title: 'A' },
      hints: { minSize: { w: 8, h: 0 } },
      placement: { size: { w: 50 } },
    });
    expect(b?.placement).toEqual({ size: { w: 120 }, pinned: 0 });
    expect(b?.hints).toEqual({ minSize: { w: 8, h: 0 } });
  });
});

describe('styled', () => {
  it('sets data.css and adds class names, changing nothing else in the tree', () => {
    const dressed = styled(PRESET, '.x { color: red; }', { a: 'product-a' });
    expect(dressed.data?.css).toBe('.x { color: red; }');
    const [a, inner] = presetTree(dressed).children ?? [];
    expect(a).toEqual({
      id: 'a',
      placement: { size: { w: 100 } },
      meta: { className: 'product-a' },
    });
    expect(inner).toEqual(presetTree(PRESET).children?.[1]);
  });

  it('keeps what data.nodes already says about a node it adds a class to', () => {
    const titled: Preset = { ...PRESET, data: { nodes: { a: { meta: { title: 'A' } } } } };
    expect(styled(titled, '', { a: 'x' }).data?.nodes?.a).toEqual({
      meta: { title: 'A' },
      className: 'x',
    });
  });

  it('adds no data.nodes when there are no classes', () => {
    expect(styled(PRESET, '.x {}').data).toEqual({ css: '.x {}' });
  });
});
