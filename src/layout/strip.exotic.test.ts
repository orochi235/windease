import { describe, expect, it } from 'vitest';
import { nodeToLayoutItem } from '../layout-node-adapter.js';
import type { Affordance, LayoutItem, LayoutResult, Rect, Size } from '../layout-types.js';
import { asNodeId, type NodeId } from '../node.js';
import type { Store } from '../store.js';
import {
  dropped,
  EPS,
  malformedRects,
  outOfBounds,
  overlaps,
  runScenario,
  type Scenario,
} from '../test-utils/exotic/invariants.js';
import { type Preset, type PresetNode, presetToStore } from '../test-utils/exotic/preset.js';
import { PATHOLOGICAL, PRESETS } from '../test-utils/exotic/strip-scenarios.js';
import { trackJoin } from './seam-join.js';
import { stripStrategy } from './strip.js';

interface Cfg {
  axis?: 'x' | 'y';
  gap?: number;
  padding?: number;
  fill?: boolean;
  resizable?: boolean;
  resizeMode?: 'redistribute' | 'neighbor';
  joinOnOvershoot?: boolean;
  joinThreshold?: number;
  overflowMode?: 'squeeze' | 'scroll' | 'unplaced';
}

const cfgOf = (s: Pick<Scenario, 'options'>) => s.options as Cfg;
const mainOf = (r: Rect | Size, axis: 'x' | 'y') => (axis === 'x' ? r.w : r.h);
const crossOf = (r: Rect | Size, axis: 'x' | 'y') => (axis === 'x' ? r.h : r.w);
const startOf = (r: Rect, axis: 'x' | 'y') => (axis === 'x' ? r.x : r.y);

const explicitOf = (it: LayoutItem, axis: 'x' | 'y') => {
  const v = axis === 'x' ? it.placement?.size?.w : it.placement?.size?.h;
  // A non-finite or negative stored size is treated as absent.
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;
};
const naturalOf = (it: LayoutItem, axis: 'x' | 'y') => {
  const asked = axis === 'x' ? it.hints?.sizing?.w : it.hints?.sizing?.h;
  const v = axis === 'x' ? it.natural?.w : it.natural?.h;
  return asked === 'content' && typeof v === 'number' ? v : undefined;
};
const minOf = (it: LayoutItem, axis: 'x' | 'y') =>
  (axis === 'x' ? it.hints?.minSize?.w : it.hints?.minSize?.h) ?? 0;
const maxOf = (it: LayoutItem, axis: 'x' | 'y') => {
  const v = axis === 'x' ? it.hints?.maxSize?.w : it.hints?.maxSize?.h;
  return typeof v === 'number' ? v : undefined;
};
const preferredOf = (it: LayoutItem, axis: 'x' | 'y') =>
  (axis === 'x' ? it.hints?.preferredSize?.w : it.hints?.preferredSize?.h) ?? 0;

/** The least a pane may render at: its min, unless it stated less or a max
 *  sits under the min, where the documented rule is that max wins. */
function floorOf(it: LayoutItem, axis: 'x' | 'y'): number {
  return Math.min(minOf(it, axis), maxOf(it, axis) ?? Infinity, explicitOf(it, axis) ?? Infinity);
}

/** Whether some placed pane is free to take whatever the others leave. */
function hasSlackTaker(s: Scenario, placed: LayoutItem[]): boolean {
  const cfg = cfgOf(s);
  const axis = cfg.axis ?? 'x';
  const requested = (it: LayoutItem) =>
    explicitOf(it, axis) !== undefined || naturalOf(it, axis) !== undefined;
  const uncapped = (it: LayoutItem) => maxOf(it, axis) === undefined;
  if (placed.some(requested)) return placed.some((it) => !requested(it) && uncapped(it));
  return !!cfg.fill && placed.some((it) => preferredOf(it, axis) === 0 && uncapped(it));
}

type Violations = string[];

/** Every generic and strip-specific invariant, as named lists of violations. */
function invariants(s: Scenario, r: LayoutResult<string>): Record<string, Violations> {
  const cfg = cfgOf(s);
  const axis = cfg.axis ?? 'x';
  const gap = cfg.gap ?? 0;
  const padding = cfg.padding ?? 0;
  const main = mainOf(s.container, axis);
  const placed = s.items.filter((it) => r.placements.has(it.id));
  const rect = (id: string) => r.placements.get(id)!;
  const extents = placed.map((it) => mainOf(rect(it.id), axis));
  const consumed =
    extents.reduce((a, b) => a + b, 0) + gap * Math.max(0, placed.length - 1) + 2 * padding;
  const excess = consumed - main;
  const reported = r.overflow ? mainOf(r.overflow, axis) : undefined;
  const out: Record<string, Violations> = {};

  out['rects are well-formed'] = malformedRects(r.placements);
  out['nothing is silently dropped'] = dropped(s.items, r);
  out['no two panes come closer than the gap'] = overlaps(r.placements, gap);

  const again = runScenario(stripStrategy, s);
  out['layout is deterministic'] =
    JSON.stringify([...again.placements], null, 0) === JSON.stringify([...r.placements]) &&
    JSON.stringify(again.affordances) === JSON.stringify(r.affordances) &&
    JSON.stringify(again.overflow) === JSON.stringify(r.overflow)
      ? []
      : ['second run differs'];

  out['stays in bounds unless overflow is reported'] = r.overflow
    ? []
    : outOfBounds(r.placements, s.container);

  const overflowReport: Violations = [];
  if (excess > EPS) {
    if (reported === undefined || Math.abs(reported - excess) > 1e-6) {
      overflowReport.push(`consumed ${consumed} of ${main}, reported ${reported}`);
    }
    if (r.overflow && crossOf(r.overflow, axis) !== 0) overflowReport.push('cross-axis overflow');
  } else if (r.overflow) {
    overflowReport.push(`reported ${reported} with ${-excess}px to spare`);
  }
  out['overflow is reported exactly'] = overflowReport;

  if (cfg.overflowMode === 'unplaced') {
    out['unplaced mode never overflows'] = r.overflow ? [`overflow ${reported}`] : [];
  }

  if ((cfg.overflowMode ?? 'squeeze') === 'squeeze' && r.overflow) {
    out['squeeze overflows only once every pane is at its floor'] = placed
      .filter((it) => mainOf(rect(it.id), axis) > floorOf(it, axis) + 1e-6)
      .map((it) => `${it.id} at ${mainOf(rect(it.id), axis)} over floor ${floorOf(it, axis)}`);
  }

  if (!r.overflow && hasSlackTaker(s, placed)) {
    out['extents and gaps fill the main axis'] =
      Math.abs(excess) > 1e-6 ? [`consumed ${consumed} of ${main}`] : [];
  }

  const packing: Violations = [];
  let cursor = padding;
  for (const it of placed) {
    const at = startOf(rect(it.id), axis);
    if (Math.abs(at - cursor) > 1e-6) packing.push(`${it.id} starts at ${at}, expected ${cursor}`);
    cursor = at + mainOf(rect(it.id), axis) + gap;
  }
  out['panes pack in order along the main axis'] = packing;

  const cross = Math.max(0, crossOf(s.container, axis) - 2 * padding);
  out['panes span the cross axis, never below zero'] = placed
    .filter((it) => Math.abs(crossOf(rect(it.id), axis) - cross) > 1e-6)
    .map((it) => `${it.id} cross ${crossOf(rect(it.id), axis)}, expected ${cross}`);

  out['floors are honored'] = placed
    .filter((it) => mainOf(rect(it.id), axis) < floorOf(it, axis) - 1e-6)
    .map((it) => `${it.id} at ${mainOf(rect(it.id), axis)} under ${floorOf(it, axis)}`);

  out['ceilings are honored'] = placed
    .filter((it) => {
      const max = maxOf(it, axis);
      return max !== undefined && mainOf(rect(it.id), axis) > max + 1e-6;
    })
    .map((it) => `${it.id} at ${mainOf(rect(it.id), axis)} over ${maxOf(it, axis)}`);

  out['seams sit on trailing edges and name their panes'] = seamShape(s, r, placed);
  out['seam bounds contain the rendered extent'] = r.affordances
    .filter((a) => a.bounds)
    .flatMap((a) => {
      const b = a.bounds!;
      const extent = mainOf(rect(String(a.childId)), axis);
      const bad: string[] = [];
      if (Math.abs(b.valueNow - extent) > 1e-6)
        bad.push(`${a.id} valueNow ${b.valueNow} ≠ ${extent}`);
      if (b.valueMin > b.valueNow + 1e-6)
        bad.push(`${a.id} valueMin ${b.valueMin} > ${b.valueNow}`);
      if (b.valueMax < b.valueNow - 1e-6)
        bad.push(`${a.id} valueMax ${b.valueMax} < ${b.valueNow}`);
      return bad;
    });
  return out;
}

function seamShape(s: Scenario, r: LayoutResult<string>, placed: LayoutItem[]): Violations {
  const cfg = cfgOf(s);
  const axis = cfg.axis ?? 'x';
  const bad: Violations = [];
  const expected = (cfg.resizable ?? true) ? Math.max(0, placed.length - 1) : 0;
  if (r.affordances.length !== expected) {
    bad.push(`${r.affordances.length} seams for ${placed.length} panes`);
  }
  r.affordances.forEach((a, i) => {
    const pane = placed[i];
    const next = placed[i + 1];
    if (!pane || a.childId !== pane.id) {
      bad.push(`${a.id} names ${String(a.childId)}, expected ${pane?.id}`);
      return;
    }
    const p = r.placements.get(pane.id)!;
    const edge = startOf(p, axis) + mainOf(p, axis);
    const center = startOf(a.rect, axis) + mainOf(a.rect, axis) / 2;
    if (Math.abs(center - edge) > 1e-6) bad.push(`${a.id} centered at ${center}, edge at ${edge}`);
    if (a.bounds?.orientation !== (axis === 'x' ? 'horizontal' : 'vertical')) {
      bad.push(`${a.id} orientation ${a.bounds?.orientation}`);
    }
    const neighbor = cfg.resizeMode === 'neighbor';
    const affects = neighbor && next ? [pane.id, next.id] : [pane.id];
    if (JSON.stringify(a.affects) !== JSON.stringify(affects)) {
      bad.push(`${a.id} affects ${JSON.stringify(a.affects)}`);
    }
    const joins = neighbor && (cfg.joinOnOvershoot ?? false);
    if (joins !== !!a.join) bad.push(`${a.id} join ${JSON.stringify(a.join)}`);
    if (a.join && (a.join.atMin !== pane.id || a.join.atMax !== next?.id)) {
      bad.push(`${a.id} join names ${a.join.atMin}/${a.join.atMax}`);
    }
  });
  return bad;
}

/** Items for one container, projected from a live store the way `presetScenario` does. */
function project(store: Store, containerId: string, container: Size): Scenario {
  const parent = store.getNode(asNodeId(containerId) as NodeId)!;
  const items = parent
    .container!.childOrder.map((id) => store.getNode(id))
    .filter((n) => n !== undefined)
    .map(nodeToLayoutItem);
  return {
    id: containerId,
    source: '',
    stress: '',
    container,
    items,
    options: (parent.container!.config ?? {}) as Record<string, unknown>,
  };
}

interface Laid {
  scenario: Scenario;
  result: LayoutResult<string>;
  /** Container origin in root coordinates. */
  origin: { x: number; y: number };
  /** Whether this container or any ancestor reported overflow. */
  overflowed: boolean;
}

/** Lays out every strip container of `preset`, each at the rect its parent gave it. */
function layoutTree(preset: Preset, store: Store = presetToStore(preset)): Laid[] {
  const out: Laid[] = [];
  const walk = (
    node: PresetNode,
    size: Size,
    origin: { x: number; y: number },
    inherited: boolean,
  ) => {
    const s = project(store, node.id, size);
    s.id = node.id === preset.root.id ? preset.id : `${preset.id}/${node.id}`;
    s.source = preset.source;
    s.stress = preset.stress;
    const result = runScenario(stripStrategy, s);
    const overflowed = inherited || !!result.overflow;
    out.push({ scenario: s, result, origin, overflowed });
    for (const child of node.children ?? []) {
      const r = result.placements.get(child.id);
      if (child.strategy === 'strip' && r) {
        walk(child, { w: r.w, h: r.h }, { x: origin.x + r.x, y: origin.y + r.y }, overflowed);
      }
    }
  };
  walk(preset.root, preset.viewport, { x: 0, y: 0 }, false);
  return out;
}

/**
 * Defects these fixtures expose, keyed `scenario id » invariant`. Each entry
 * runs as `it.fails` and names the defect, so a fix turns it red here first.
 */
const KNOWN: Record<string, string> = {
  // Open question rather than a settled defect: `squeeze`'s docstring says it
  // scales panes down, but strip.test.ts pins preferredSize as unscaled.
  'vscode-hinted-sidebars@400-squeeze » squeeze overflows only once every pane is at its floor':
    'squeeze never scales preferredSize, so floors do not bind before overflow',
};

describe('strip on real-software layouts', () => {
  const laid = PRESETS.flatMap((p) => layoutTree(p));
  const scenarios: Array<{ scenario: Scenario; result: LayoutResult<string> }> = [
    ...laid,
    ...PATHOLOGICAL.map((scenario) => ({ scenario, result: runScenario(stripStrategy, scenario) })),
  ];

  for (const { scenario, result } of scenarios) {
    describe(`${scenario.id} — ${scenario.source}`, () => {
      for (const [name, violations] of Object.entries(invariants(scenario, result))) {
        const defect = KNOWN[`${scenario.id} » ${name}`];
        (defect ? it.fails : it)(defect ? `${name} [defect: ${defect}]` : name, () => {
          expect(violations, violations.join('; ')).toEqual([]);
        });
      }
    });
  }
});

describe('nested presets tile their viewport', () => {
  for (const preset of PRESETS.filter((p) => (p.root.children ?? []).some((c) => c.strategy))) {
    it(`${preset.id}: every nested container fits inside its parent's rect`, () => {
      const laid = layoutTree(preset);
      const bad: string[] = [];
      for (const l of laid) {
        if (l.overflowed) continue;
        for (const [id, r] of l.result.placements) {
          const x = l.origin.x + r.x;
          const y = l.origin.y + r.y;
          if (x < -EPS || y < -EPS) bad.push(`${id} starts at ${x},${y}`);
          if (x + r.w > preset.viewport.w + 1e-6 || y + r.h > preset.viewport.h + 1e-6) {
            bad.push(`${id} ends at ${x + r.w},${y + r.h}`);
          }
        }
      }
      expect(bad).toEqual([]);
    });
  }

  it('blender-recursive-split: the ten-deep split overflows only where the header floor binds', () => {
    const laid = layoutTree(PRESETS.find((p) => p.id === 'blender-recursive-split')!);
    expect(laid).toHaveLength(10);
    const first = laid.findIndex((l) => l.result.overflow);
    expect(first).toBeGreaterThan(0);
    const at = laid[first]!;
    const axis = cfgOf(at.scenario).axis ?? 'x';
    for (const r of at.result.placements.values()) {
      expect(mainOf(r, axis)).toBeCloseTo(axis === 'y' ? 26 : 29, 9);
    }
  });
});

/** A fake-free drag: dispatch on the real store, then re-project. */
function dragSeam(
  store: Store,
  containerId: string,
  size: Size,
  seamId: string,
  delta: number,
): { before: LayoutResult<string>; after: LayoutResult<string>; seam: Affordance; s: Scenario } {
  const s = project(store, containerId, size);
  const before = runScenario(stripStrategy, s);
  const seam = before.affordances.find((a) => a.id === seamId)!;
  const axis = cfgOf(s).axis ?? 'x';
  stripStrategy.dispatchAffordance!({
    event: {
      affordanceId: seamId,
      kind: 'drag',
      payload: axis === 'x' ? { dx: delta, dy: 0 } : { dx: 0, dy: delta },
    },
    affordance: seam,
    store,
    parentId: asNodeId(containerId),
    container: size,
    options: s.options,
    items: s.items,
  });
  const after = runScenario(stripStrategy, project(store, containerId, size));
  return { before, after, seam, s };
}

const DRAG = 16;

/** One drag of `DRAG` px each way on every seam of every container, from a fresh store. */
function gestureInvariants(preset: Preset): Record<string, Violations> {
  const out: Record<string, Violations> = {
    'a drag never moves its seam backward': [],
    'a drag lands inside the range its seam advertised': [],
    'a drag writes finite, non-negative sizes': [],
  };
  const neighborKey = 'a neighbor drag moves only the two panes beside its seam';
  for (const l of layoutTree(preset)) {
    const containerId = l.scenario.id.includes('/') ? l.scenario.id.split('/')[1]! : preset.root.id;
    const cfg = cfgOf(l.scenario);
    const axis = cfg.axis ?? 'x';
    if (cfg.resizeMode === 'neighbor') out[neighborKey] ??= [];
    for (const seam of l.result.affordances) {
      for (const delta of [DRAG, -DRAG]) {
        const store = presetToStore(preset);
        const size = l.scenario.container;
        const { before, after } = dragSeam(store, containerId, size, seam.id, delta);
        const tag = `${seam.id} ${delta > 0 ? '+' : ''}${delta}`;
        const edge = (r: LayoutResult<string>) => {
          const p = r.placements.get(String(seam.childId))!;
          return startOf(p, axis) + mainOf(p, axis);
        };
        const moved = edge(after) - edge(before);
        if (moved * delta < -1e-6)
          out['a drag never moves its seam backward']!.push(`${tag} moved ${moved}`);

        const b = seam.bounds!;
        const now = mainOf(after.placements.get(String(seam.childId))!, axis);
        if (now < b.valueMin - 1e-6 || now > b.valueMax + 1e-6) {
          out['a drag lands inside the range its seam advertised']!.push(
            `${tag} at ${now}, range [${b.valueMin}, ${b.valueMax}]`,
          );
        }

        for (const it of project(store, containerId, size).items) {
          const v = axis === 'x' ? it.placement?.size?.w : it.placement?.size?.h;
          if (typeof v === 'number' && (!Number.isFinite(v) || v < 0)) {
            out['a drag writes finite, non-negative sizes']!.push(`${tag} wrote ${it.id}=${v}`);
          }
        }

        if (cfg.resizeMode === 'neighbor') {
          const pair = new Set(seam.affects?.map(String));
          for (const [id, r] of before.placements) {
            if (pair.has(id)) continue;
            const a = after.placements.get(id)!;
            if (Math.abs(mainOf(a, axis) - mainOf(r, axis)) > 1e-6) {
              out[neighborKey]!.push(`${tag} moved ${id} ${mainOf(r, axis)} → ${mainOf(a, axis)}`);
            }
          }
        }
      }
    }
  }
  return out;
}

describe('seam drags on real-software layouts', () => {
  for (const preset of PRESETS) {
    describe(preset.id, () => {
      for (const [name, violations] of Object.entries(gestureInvariants(preset))) {
        const defect = KNOWN[`${preset.id} » ${name}`];
        (defect ? it.fails : it)(defect ? `${name} [defect: ${defect}]` : name, () => {
          expect(violations, violations.join('; ')).toEqual([]);
        });
      }
    });
  }
});

interface JoinRun {
  armedAt: number | undefined;
  candidate: string | undefined;
  extents: number[];
}

/** Pushes one seam `steps` moves of `step` px, feeding `trackJoin` the bounds the
 *  layout advertised before each move — the order the React layer uses. */
function push(
  preset: Preset,
  containerId: string,
  seamId: string,
  step: number,
  steps: number,
  canDestroy: (id: string) => boolean = () => true,
): JoinRun {
  const store = presetToStore(preset);
  const size = layoutTree(preset).find((l) =>
    containerId === preset.root.id
      ? l.scenario.id === preset.id
      : l.scenario.id === `${preset.id}/${containerId}`,
  )!.scenario.container;
  let overshoot = 0;
  let armedAt: number | undefined;
  let candidate: string | undefined;
  const extents: number[] = [];
  for (let i = 0; i < steps; i++) {
    const { seam, after, s } = dragSeam(store, containerId, size, seamId, step);
    const state = trackJoin({
      join: seam.join!,
      overshoot,
      delta: step,
      atMin: seam.bounds!.atMin,
      atMax: seam.bounds!.atMax,
      canDestroy: (id) => canDestroy(String(id)),
    });
    overshoot = state.overshoot;
    if (state.armed && armedAt === undefined) {
      armedAt = i;
      candidate = String(state.candidateId);
    }
    const victim = step > 0 ? seam.join!.atMax! : seam.join!.atMin!;
    extents.push(mainOf(after.placements.get(String(victim))!, cfgOf(s).axis ?? 'x'));
  }
  return { armedAt, candidate, extents };
}

describe('seam joins on real-software layouts', () => {
  const blender = PRESETS.find((p) => p.id === 'blender-layout-workspace')!;
  const bloomberg = PRESETS.find((p) => p.id === 'bloomberg-four-panel')!;
  const recursive = PRESETS.find((p) => p.id === 'blender-recursive-split')!;

  it('blender: the timeline shrinks to its header, then arms only after 24px more', () => {
    // 96 → 26 is 70px of travel at 5px a move: 14 moves reach the floor, and
    // the move that lands on it still reads unpinned.
    const run = push(blender, 'blender', 'resize-y-bl-main', 5, 30);
    expect(Math.min(...run.extents)).toBeCloseTo(26, 9);
    expect(run.extents.every((e) => e >= 26 - EPS)).toBe(true);
    expect(run.candidate).toBe('bl-timeline');
    // The 14th move (index 13) lands on the floor; from index 14 each move adds
    // 5 of overshoot, and index 18 is the first past 24.
    expect(run.armedAt).toBe(18);
  });

  it('blender: a destroy-refusing timeline never arms, however far the seam is pushed', () => {
    const run = push(blender, 'blender', 'resize-y-bl-main', 5, 60, (id) => id !== 'bl-timeline');
    expect(run.armedAt).toBeUndefined();
    expect(run.extents.at(-1)).toBeCloseTo(26, 9);
  });

  it('blender: the fixed-height top bar is pinned at both ends, so its seam never arms', () => {
    for (const step of [4, -4]) {
      expect(push(blender, 'blender', 'resize-y-bl-topbar', step, 20).armedAt).toBeUndefined();
    }
  });

  it('blender: the outliner seam arms toward the properties editor at its header floor', () => {
    const run = push(blender, 'bl-right', 'resize-y-bl-outliner', 8, 80);
    expect(run.candidate).toBe('bl-properties');
    expect(Math.min(...run.extents)).toBeCloseTo(26, 9);
  });

  it('bloomberg: floors past the container pin every seam at both ends, so none arms', () => {
    for (const [container, seam] of [
      ['bbg', 'resize-y-bbg-row-1'],
      ['bbg-row-1', 'resize-x-bbg-1'],
      ['bbg-row-2', 'resize-x-bbg-3'],
    ] as const) {
      for (const step of [6, -6]) {
        const run = push(bloomberg, container, seam, step, 20);
        expect(run.armedAt, `${seam} ${step}`).toBeUndefined();
        expect(new Set(run.extents).size, `${seam} ${step} moved`).toBe(1);
      }
    }
  });

  it('blender-recursive-split: the overflowing innermost split never arms', () => {
    const run = push(recursive, 'split-9', 'resize-y-area-9', 4, 20);
    expect(run.armedAt).toBeUndefined();
  });
});

describe('strip under the other overflow modes', () => {
  const vscode = PRESETS.find((p) => p.id === 'vscode-every-sidebar')!;
  const hinted = PRESETS.find((p) => p.id === 'vscode-hinted-sidebars')!;
  const firefox = PRESETS.find((p) => p.id === 'firefox-100-tabs')!;
  const at = (preset: Preset, options: Record<string, unknown>, container = preset.viewport) => {
    const s = project(presetToStore(preset), preset.root.id, container);
    return { ...s, id: preset.id, options: { ...s.options, ...options } };
  };

  const modes: Scenario[] = [
    { ...at(vscode, { overflowMode: 'scroll' }), id: 'vscode-every-sidebar@scroll' },
    { ...at(vscode, { overflowMode: 'unplaced' }), id: 'vscode-every-sidebar@unplaced' },
    {
      ...at(hinted, { overflowMode: 'unplaced' }, { w: 400, h: 900 }),
      id: 'vscode-hinted-sidebars@400-unplaced',
    },
    {
      ...at(hinted, { overflowMode: 'squeeze' }, { w: 400, h: 900 }),
      id: 'vscode-hinted-sidebars@400-squeeze',
    },
    { ...at(firefox, { overflowMode: 'unplaced' }), id: 'firefox-100-tabs@unplaced' },
    { ...at(firefox, { overflowMode: 'squeeze' }), id: 'firefox-100-tabs@squeeze' },
  ];

  for (const scenario of modes) {
    describe(scenario.id, () => {
      const result = runScenario(stripStrategy, scenario);
      for (const [name, violations] of Object.entries(invariants(scenario, result))) {
        const defect = KNOWN[`${scenario.id} » ${name}`];
        (defect ? it.fails : it)(defect ? `${name} [defect: ${defect}]` : name, () => {
          expect(violations, violations.join('; ')).toEqual([]);
        });
      }
    });
  }

  it('firefox: scroll mode reports the whole tab run as overflow', () => {
    const r = runScenario(stripStrategy, at(firefox, {}));
    // 3 pinned at 40 and 97 tabs at their 76px floor.
    expect(r.overflow?.w).toBeCloseTo(3 * 40 + 97 * 76 - 1280, 9);
  });

  it('firefox: pinned tabs survive a count cap that drops ordinary ones', () => {
    const store = presetToStore(firefox);
    for (const i of [1, 2, 3]) store.setPinned(asNodeId(`pinned-${i}`), i - 1);
    const s = project(store, firefox.root.id, firefox.viewport);
    const r = runScenario(stripStrategy, { ...s, options: { ...s.options, maxItems: 10 } });
    expect([...r.placements.keys()].slice(0, 3)).toEqual(['pinned-1', 'pinned-2', 'pinned-3']);
    expect(r.unplaced).toHaveLength(90);
  });

  it('tmux: forty equal shares and thirty-nine borders end exactly at the right edge', () => {
    const r = runScenario(
      stripStrategy,
      at(PRESETS.find((p) => p.id === 'tmux-even-horizontal-40')!, {}),
    );
    const last = r.placements.get('pane-39')!;
    expect(Math.abs(last.x + last.w - 1366)).toBeLessThan(1e-9);
    for (const p of r.placements.values()) expect(p.w).toBeCloseTo((1366 - 39) / 40, 9);
  });
});
