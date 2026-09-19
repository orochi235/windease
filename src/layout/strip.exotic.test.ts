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
import {
  type Preset,
  type PresetNode,
  presetToStore,
  presetTree,
} from '../test-utils/exotic/preset.js';
import { PATHOLOGICAL, PRESETS } from '../test-utils/exotic/strip-scenarios.js';
import { captureSeam, commitJoin, trackJoin } from './seam-join.js';
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
  overshoot?: 'join' | 'hide';
  overflowMode?: 'squeeze' | 'scroll' | 'unplaced';
  justify?: 'start' | 'center' | 'end' | 'between';
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
  const free = Math.max(0, -excess);
  const n = placed.length;
  const lead = cfg.justify === 'center' ? free / 2 : cfg.justify === 'end' ? free : 0;
  const step = gap + (cfg.justify === 'between' && n > 1 ? free / (n - 1) : 0);
  let cursor = padding + lead;
  for (const it of placed) {
    const at = startOf(rect(it.id), axis);
    if (Math.abs(at - cursor) > 1e-6) packing.push(`${it.id} starts at ${at}, expected ${cursor}`);
    cursor = at + mainOf(rect(it.id), axis) + step;
  }
  out['panes pack in order along the main axis, leftover placed by justify'] = packing;

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
    const mode = cfg.overshoot ?? (cfg.joinOnOvershoot ? 'join' : undefined);
    const joins = neighbor && mode !== undefined;
    if (joins !== !!a.join) bad.push(`${a.id} join ${JSON.stringify(a.join)}`);
    if (a.join && (a.join.action ?? 'join') !== mode) {
      bad.push(`${a.id} join action ${a.join.action}, expected ${mode}`);
    }
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
    s.id = node.id === preset.mechanics.id ? preset.id : `${preset.id}/${node.id}`;
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
  walk(presetTree(preset), preset.viewport, { x: 0, y: 0 }, false);
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
  'tmux-even-horizontal-40 » overflow is reported exactly':
    "step's remainder arithmetic leaves the last pane 4.5e-13px long, reported as overflow",
  'tmux-even-horizontal-40 » squeeze overflows only once every pane is at its floor':
    'the same phantom 4.5e-13px overflow, with every pane above its floor',
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
  for (const preset of PRESETS.filter((p) =>
    (presetTree(p).children ?? []).some((c) => c.strategy),
  )) {
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
    const containerId = l.scenario.id.includes('/')
      ? l.scenario.id.split('/')[1]!
      : preset.mechanics.id;
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
          const share = it.placement?.share;
          if (
            share !== undefined &&
            !(typeof share === 'number' && Number.isFinite(share) && share > 0)
          ) {
            out['a drag writes finite, non-negative sizes']!.push(
              `${tag} wrote ${it.id} share ${share}`,
            );
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
    containerId === preset.mechanics.id
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
    const s = project(presetToStore(preset), preset.mechanics.id, container);
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
    const s = project(store, firefox.mechanics.id, firefox.viewport);
    const r = runScenario(stripStrategy, { ...s, options: { ...s.options, maxItems: 10 } });
    expect([...r.placements.keys()].slice(0, 3)).toEqual(['pinned-1', 'pinned-2', 'pinned-3']);
    expect(r.unplaced).toHaveLength(90);
  });

  it('tmux: forty panes in whole cells and one-cell borders end exactly at the right edge', () => {
    const r = runScenario(
      stripStrategy,
      at(PRESETS.find((p) => p.id === 'tmux-even-horizontal-40')!, {}),
    );
    const panes = [...r.placements.values()];
    const last = panes.at(-1)!;
    expect(Math.abs(last.x + last.w - 1366)).toBeLessThan(1e-9);
    // (1366 - 39 × 8) / 40 is 26.35px, which rounds to three cells; the last pane takes the rest.
    for (const p of panes.slice(0, -1)) expect(p.w).toBe(24);
    for (let i = 1; i < panes.length; i++) {
      expect(panes[i]!.x - (panes[i - 1]!.x + panes[i - 1]!.w)).toBe(8);
    }
  });
});

describe('behavior keys on real-software layouts', () => {
  const byId = (id: string) => PRESETS.find((p) => p.id === id)!;
  const layout = (preset: Preset) =>
    runScenario(
      stripStrategy,
      project(presetToStore(preset), preset.mechanics.id, preset.viewport),
    );

  it('firefox: three tabs sit at their 225px cap from the left, the rest of the strip empty', () => {
    const r = layout(byId('firefox-3-tabs'));
    expect([...r.placements].map(([id, p]) => [id, p.x, p.w])).toEqual([
      ['tab-1', 0, 225],
      ['tab-2', 225, 225],
      ['tab-3', 450, 225],
    ]);
  });

  it('obsidian: the capped note sits centered between sidebars flush to the edges', () => {
    const r = layout(byId('obsidian-readable-line'));
    const files = r.placements.get('ob-files')!;
    const note = r.placements.get('ob-note')!;
    const outline = r.placements.get('ob-outline')!;
    expect(files.x).toBe(0);
    expect(outline.x + outline.w).toBeCloseTo(1920, 9);
    expect(note.x - (files.x + files.w)).toBeCloseTo(outline.x - (note.x + note.w), 9);
  });

  it('tmux: a seam drag lands on a whole cell', () => {
    const store = presetToStore(byId('tmux-even-horizontal-40'));
    const { after } = dragSeam(store, 'tmux', { w: 1366, h: 768 }, 'resize-x-pane-0', 10);
    // 24 + 10 is nearer four cells than five; the neighbor gives up the same cell.
    expect(after.placements.get('pane-0')!.w).toBe(32);
    expect(after.placements.get('pane-1')!.w).toBe(16);
  });

  it('emacs: every window is a whole number of 8px columns', () => {
    for (const p of layout(byId('emacs-balanced-past-min')).placements.values()) {
      expect(p.w % 8).toBe(0);
    }
  });

  it('firefox: the three pinned tabs stick at the start of the scrolling strip, one after another', () => {
    expect(layout(byId('firefox-100-tabs')).sticky).toEqual(
      new Map([
        ['pinned-1', { x: 0 }],
        ['pinned-2', { x: 40 }],
        ['pinned-3', { x: 80 }],
      ]),
    );
  });

  it('emacs: a seam drag writes shares, so windows keep their proportions when the frame resizes', () => {
    const store = presetToStore(byId('emacs-balanced-past-min'));
    const wide = { w: 2400, h: 768 };
    dragSeam(store, 'emacs', wide, 'resize-x-window-0', 40);
    const items = project(store, 'emacs', wide).items;
    expect(items.every((it) => it.placement?.size === undefined)).toBe(true);
    const at = (w: number) =>
      runScenario(stripStrategy, project(store, 'emacs', { w, h: 768 })).placements;
    const ratio = (p: Map<string, Rect>) => p.get('window-0')!.w / p.get('window-1')!.w;
    expect(ratio(at(2400))).toBeGreaterThan(1.2);
    // Each width rounds to a whole 8px column, so the ratio holds to within a column.
    expect(Math.abs(ratio(at(3000)) - ratio(at(2400)))).toBeLessThan(8 / 120);
  });
});

describe("VS Code: a sidebar dragged shut hides (overshoot: 'hide')", () => {
  const hinted = PRESETS.find((p) => p.id === 'vscode-hinted-sidebars')!;
  const size = hinted.viewport;
  const shown = (store: Store) => {
    const s = project(store, 'vscode-hinted', size);
    const hidden = new Set(
      store
        .getChildren(asNodeId('vscode-hinted'))
        .filter((n) => n.lifecycle.state === 'hidden')
        .map((n) => String(n.id)),
    );
    return runScenario(stripStrategy, { ...s, items: s.items.filter((it) => !hidden.has(it.id)) });
  };

  /** Pushes `seamId` by `step` until the join arms or `steps` run out, then releases. */
  function pushAndRelease(store: Store, seamId: string, step: number, steps: number) {
    const first = shown(store).affordances.find((a) => a.id === seamId)!;
    const before = captureSeam(store, first);
    let overshoot = 0;
    let armed: string | undefined;
    for (let i = 0; i < steps && armed === undefined; i++) {
      const { seam } = dragSeam(store, 'vscode-hinted', size, seamId, step);
      const state = trackJoin({
        join: seam.join!,
        overshoot,
        delta: step,
        atMin: seam.bounds!.atMin,
        atMax: seam.bounds!.atMax,
        canDestroy: () => true,
      });
      overshoot = state.overshoot;
      if (state.armed) armed = String(state.candidateId);
    }
    if (armed) commitJoin(store, first, asNodeId(armed), before);
    return armed;
  }

  it('pushing the Explorer past its 170px floor hides it, and the row goes back as the drag found it', () => {
    const store = presetToStore(hinted);
    expect(pushAndRelease(store, 'resize-x-vh-sidebar', -20, 20)).toBe('vh-sidebar');
    expect(store.getNode(asNodeId('vh-sidebar'))?.lifecycle.state).toBe('hidden');
    const r = shown(store);
    expect(r.placements.get('vh-activity')!.w).toBe(48);
    expect(r.placements.get('vh-aux')!.w).toBe(300);
    expect(r.placements.get('vh-editor')!.w).toBe(1600 - 48 - 300);
  });

  it('showing it again brings it back at its width from before the drag', () => {
    const store = presetToStore(hinted);
    pushAndRelease(store, 'resize-x-vh-sidebar', -20, 20);
    store.showNode(asNodeId('vh-sidebar'));
    const r = shown(store);
    expect(r.placements.get('vh-sidebar')!.w).toBe(300);
    expect(r.placements.get('vh-editor')!.w).toBe(1600 - 48 - 300 - 300);
  });

  it.fails("pushing the Explorer's seam into the editor never hides the editor [defect: overshoot: 'hide' arms on whichever pane the seam squeezes, and nothing, lock.destroy included, keeps one pane in the row from hiding]", () => {
    const store = presetToStore(hinted);
    expect(pushAndRelease(store, 'resize-x-vh-sidebar', 40, 60)).toBeUndefined();
  });
});
