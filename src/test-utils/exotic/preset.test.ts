import { describe, expect, it } from 'vitest';
import { asNodeId } from '../../node.js';
import { type Preset, presetProperties, presetScenario, presetToStore } from './preset.js';

const PRESET: Preset = {
  id: 'tiny',
  source: 'test',
  stress: 'none',
  description: 'test',
  viewport: { w: 300, h: 200 },
  root: {
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
      root: { id: 'r', strategy: 'strip', children: [{ id: 'x' }, { id: 'x' }] },
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
    root: {
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
