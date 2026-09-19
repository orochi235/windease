import { describe, expect, it } from 'vitest';
import { createNode } from '../constructors.js';
import type { LayoutItem, Size } from '../layout-types.js';
import { asNodeId } from '../node.js';
import {
  dropped,
  malformedRects,
  prng,
  runScenario,
  type Scenario,
} from '../test-utils/exotic/invariants.js';
import {
  CHROME_150_TABS,
  PHOTOSHOP_PANELS,
  STACK_PATHOLOGY,
} from '../test-utils/exotic/overlap-scenarios.js';
import { type Preset, presetScenario, presetToStore } from '../test-utils/exotic/preset.js';
import { stackStrategy } from './stack.js';

const run = (s: Pick<Scenario, 'items' | 'container' | 'options'>) => runScenario(stackStrategy, s);

/** One child placed, every other one unplaced in child order, none dropped. */
function expectExactlyOneShown(
  s: Pick<Scenario, 'items' | 'container' | 'options'>,
  active: string,
) {
  const r = run(s);
  expect([...r.placements.keys()]).toEqual([active]);
  expect(r.unplaced ?? []).toEqual(s.items.map((i) => i.id).filter((id) => id !== active));
  expect(dropped(s.items, r)).toEqual([]);
  expect(malformedRects(r.placements)).toEqual([]);
  return r;
}

describe('Chrome with 150 tabs', () => {
  const s = presetScenario(CHROME_150_TABS);

  it('shows only the active last tab, under the 34px strip', () => {
    const r = expectExactlyOneShown(s, 'chrome-tab-150');
    expect(r.placements.get('chrome-tab-150')).toEqual({ x: 0, y: 34, z: 0, w: 1024, h: 606 });
  });

  it('is deterministic', () => {
    expect(run(s)).toEqual(run(s));
  });

  // Contract: a stale activeId falls back to the first child. Chrome would show the neighbor, tab 149.
  it('closing the active last tab jumps back to the first tab, not its neighbor', () => {
    const store = presetToStore(CHROME_150_TABS);
    store.unregisterNode(asNodeId('chrome-tab-150'));
    const tabs = CHROME_150_TABS.data!.children!['chrome-window']!;
    const after = presetScenario({
      ...CHROME_150_TABS,
      data: { children: { 'chrome-window': tabs.slice(0, 149) } },
    });
    expect(store.getNode(asNodeId('chrome-window'))?.container?.config).toMatchObject({
      activeId: 'chrome-tab-150',
    });
    expectExactlyOneShown(after, 'chrome-tab-1');
  });

  it('keeps one tab shown whichever of the 150 is active', () => {
    for (let k = 1; k <= 150; k++) {
      expectExactlyOneShown(
        { ...s, options: { ...s.options, activeId: `chrome-tab-${k}` } },
        `chrome-tab-${k}`,
      );
    }
  });
});

describe('Photoshop: stacks docked in a strip', () => {
  it('each docked group shows exactly its active tab', () => {
    const dock: Size = { w: 280, h: 359 };
    expectExactlyOneShown(presetScenario(PHOTOSHOP_PANELS, 'ps-group-layers', dock), 'ps-layers');
    expectExactlyOneShown(
      presetScenario(PHOTOSHOP_PANELS, 'ps-group-props', dock),
      'ps-properties',
    );
  });

  it('switching tabs with setActiveChild moves the body to the new tab', () => {
    const store = presetToStore(PHOTOSHOP_PANELS);
    store.setActiveChild(asNodeId('ps-group-layers'), asNodeId('ps-paths'));
    const s = presetScenario(PHOTOSHOP_PANELS, 'ps-group-layers', { w: 280, h: 359 });
    const options = (store.getNode(asNodeId('ps-group-layers'))?.container?.config ?? {}) as Record<
      string,
      unknown
    >;
    expectExactlyOneShown({ ...s, options }, 'ps-paths');
  });

  it('dragging the active tab into the other group shows it there and falls back here', () => {
    const store = presetToStore(PHOTOSHOP_PANELS);
    store.moveNode(asNodeId('ps-layers'), asNodeId('ps-group-props'));
    const items = (parent: string): LayoutItem[] =>
      (store.getNode(asNodeId(parent))?.container?.childOrder ?? []).map((id) => ({ id }));
    const config = (parent: string) =>
      (store.getNode(asNodeId(parent))?.container?.config ?? {}) as Record<string, unknown>;
    const container = { w: 280, h: 359 };
    expectExactlyOneShown(
      { items: items('ps-group-layers'), container, options: config('ps-group-layers') },
      'ps-channels',
    );
    expectExactlyOneShown(
      { items: items('ps-group-props'), container, options: config('ps-group-props') },
      'ps-properties',
    );
  });
});

describe("Photoshop with show: 'dropped' on its groups", () => {
  /** The preset as Photoshop behaves, where a panel dropped into a group becomes its shown tab. */
  const withShow = (): Preset => {
    const tree = structuredClone(PHOTOSHOP_PANELS.mechanics);
    const dock = tree.children!.find((c) => c.id === 'ps-dock')!;
    for (const group of dock.children!) group.config = { ...group.config, show: 'dropped' };
    return { ...PHOTOSHOP_PANELS, mechanics: tree };
  };

  it('keeps the activeId it declares when built', () => {
    const store = presetToStore(withShow());
    const config = store.getNode(asNodeId('ps-group-layers'))?.container?.config as
      | { activeId?: string }
      | undefined;
    expect(config?.activeId).toBe('ps-layers');
  });

  it('shows a tab opened after the build', async () => {
    const store = presetToStore(withShow());
    await Promise.resolve();
    store.registerNode(
      createNode({
        id: asNodeId('ps-history'),
        kind: 'panel',
        parentId: asNodeId('ps-group-layers'),
      }),
    );
    const config = store.getNode(asNodeId('ps-group-layers'))?.container?.config as
      | { activeId?: string }
      | undefined;
    expect(config?.activeId).toBe('ps-history');
  });
});

describe('stack pathology', () => {
  const byId = Object.fromEntries(STACK_PATHOLOGY.map((s) => [s.id, s]));

  it('gives the body zero height, not a negative one, when the header is taller than the window', () => {
    const r = expectExactlyOneShown(byId['stack-header-taller-than-container']!, 'b');
    expect(r.placements.get('b')).toMatchObject({ h: 0, w: 500 });
  });

  it('places a zero-size body in a 0×0 container', () => {
    const r = expectExactlyOneShown(byId['stack-container-0x0']!, 'a');
    expect(r.placements.get('a')).toMatchObject({ w: 0, h: 0 });
  });

  it('shows exactly one child for every seeded size, header and activeId', () => {
    const rand = prng(150);
    for (let k = 0; k < 300; k++) {
      const n = rand(1, 40);
      const items = Array.from({ length: n }, (_, i) => ({ id: `t${i}` }));
      const pick = rand(0, n);
      const activeId = pick === n ? 'closed' : `t${pick}`;
      const s = {
        items,
        container: { w: rand(0, 1600), h: rand(0, 1000) },
        options: { activeId, headerSize: rand(0, 1200), padding: rand(0, 40) },
      };
      expectExactlyOneShown(s, pick === n ? 't0' : activeId);
    }
  });
});
