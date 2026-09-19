import { createNode } from '../../constructors.js';
import { nodeToLayoutItem } from '../../layout-node-adapter.js';
import type { Size } from '../../layout-types.js';
import type { LockSet } from '../../lock.js';
import { asNodeId, type Node, type NodeHints, type NodeId } from '../../node.js';
import { Store } from '../../store.js';
import type { Scenario } from './invariants.js';

/**
 * One node of a preset tree. Mirrors `CreateNodeInput` with ids as plain
 * strings and children nested, so a preset is JSON-safe and reads top-down.
 * A node with `strategy` is a container; one with a parent gets membership.
 */
export interface PresetNode {
  id: string;
  kind?: string;
  /** `container.strategyId`. Present → the node is a container. */
  strategy?: string;
  config?: Record<string, unknown>;
  /** The container's persisted strategy state (saved positions, anchors…), as `setContainerState` takes it. */
  state?: unknown;
  hints?: NodeHints;
  placement?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  lock?: boolean | LockSet;
  /** Shown, then hidden — `hidden` proper, which layout skips, not merely `mounted`. */
  hidden?: boolean;
  children?: PresetNode[];
  /**
   * On a container: the mechanics every child `data.children` adds to it gets —
   * floors, spans, drag. The child's own values win, key by key, so a data
   * child need carry only what its content decides.
   */
  item?: Omit<PresetNode, 'id' | 'children' | 'item'>;
}

const MERGED = ['config', 'hints', 'placement', 'meta'] as const;

/** `child` over `template`: object fields merge key by key, anything else falls back. */
function withTemplate(template: NonNullable<PresetNode['item']>, child: PresetNode): PresetNode {
  const out: Record<string, unknown> = { ...template, ...child };
  for (const key of MERGED) {
    const t = template[key] as Record<string, unknown> | undefined;
    const c = child[key] as Record<string, unknown> | undefined;
    if (t !== undefined && c !== undefined) out[key] = { ...t, ...c };
  }
  return out as unknown as PresetNode;
}

/**
 * A layout reproduced from real software, as a canned tree: what it is, what
 * it stresses, the viewport it was designed for, and the tree itself. One
 * preset feeds a store (stories, e2e, tree tests) and, per container, a flat
 * {@link Scenario} (strategy tests).
 */
export interface Preset {
  id: string;
  /** The real product or corpus, e.g. "Blender 4.x default workspace". */
  source: string;
  /** What about it stresses the library, in one line. */
  stress: string;
  /**
   * What the real layout is and how people use it, for a reader who has never
   * seen the product: the regions, what a user drags or clicks, and what the
   * product does when space runs out. Two to four sentences.
   */
  description: string;
  viewport: Size;
  /** What the product's layout engine decides, whatever the content: strategies, config, floors, pins, spans, locks, state. */
  mechanics: PresetNode;
  /** What the content decides: titles, content-driven sizes, and the children a content container holds. */
  data?: PresetData;
}

/** The content half of a {@link Preset}, merged onto its mechanics by {@link presetTree}. */
export interface PresetData {
  /** Per node: what the content contributes. `className` lands in `meta.className`. */
  nodes?: Record<
    string,
    { meta?: Record<string, unknown>; hints?: { preferredSize?: Size }; className?: string }
  >;
  /** Children the content supplies to a container the mechanics declare, appended after its own. */
  children?: Record<string, PresetNode[]>;
  /** Styles scoped under the preset's root class, to look like the product. */
  css?: string;
}

/** `data.nodes` that give each id a display title. */
export function titles(map: Record<string, string>): NonNullable<PresetData['nodes']> {
  return Object.fromEntries(Object.entries(map).map(([id, title]) => [id, { meta: { title } }]));
}

/**
 * The preset's full node tree: its mechanics with `data.nodes` merged onto the
 * matching nodes and `data.children` appended to the matching containers.
 * Throws when a data key names no node, or `data.children` names a non-container.
 */
export function presetTree(preset: Preset): PresetNode {
  const nodes = preset.data?.nodes ?? {};
  const extra = preset.data?.children ?? {};
  const seen = new Set<string>();
  const build = (node: PresetNode): PresetNode => {
    seen.add(node.id);
    const out: PresetNode = { ...node };
    const d = Object.hasOwn(nodes, node.id) ? nodes[node.id] : undefined;
    if (d?.meta !== undefined || d?.className !== undefined) {
      out.meta = {
        ...node.meta,
        ...d.meta,
        ...(d.className === undefined ? {} : { className: d.className }),
      };
    }
    if (d?.hints?.preferredSize !== undefined) {
      out.hints = { ...node.hints, preferredSize: d.hints.preferredSize };
    }
    const added = Object.hasOwn(extra, node.id) ? extra[node.id] : undefined;
    if (added !== undefined && !node.strategy) {
      throw new Error(
        `preset ${preset.id}: data.children names ${node.id}, which is not a container`,
      );
    }
    if (node.children !== undefined || added !== undefined) {
      const template = node.item;
      const fromData = template ? (added ?? []).map((c) => withTemplate(template, c)) : added;
      out.children = [...(node.children ?? []), ...(fromData ?? [])].map(build);
    }
    return out;
  };
  const tree = build(preset.mechanics);
  for (const [key, record] of [
    ['nodes', nodes],
    ['children', extra],
  ] as const) {
    for (const id of Object.keys(record)) {
      if (!seen.has(id))
        throw new Error(`preset ${preset.id}: data.${key} names unknown node ${id}`);
    }
  }
  return tree;
}

/** Every node in `preset`'s merged tree, parents before children. */
export function presetNodes(preset: Preset): { node: PresetNode; parentId?: string }[] {
  const out: { node: PresetNode; parentId?: string }[] = [];
  const walk = (node: PresetNode, parentId?: string) => {
    out.push(parentId === undefined ? { node } : { node, parentId });
    for (const child of node.children ?? []) walk(child, node.id);
  };
  walk(presetTree(preset));
  return out;
}

/** Registers `preset` into `store` (a new one by default). Throws on a duplicate id. */
export function presetToStore(preset: Preset, store: Store = new Store()): Store {
  const seen = new Set<string>();
  for (const { node, parentId } of presetNodes(preset)) {
    if (seen.has(node.id)) throw new Error(`preset ${preset.id}: duplicate node id ${node.id}`);
    seen.add(node.id);
    const id = asNodeId(node.id);
    store.registerNode(
      createNode({
        id,
        kind: node.kind ?? (node.strategy ? 'group' : 'panel'),
        parentId: parentId === undefined ? undefined : asNodeId(parentId),
        container: node.strategy
          ? { strategyId: node.strategy, config: node.config ?? {} }
          : undefined,
        focus: !node.strategy,
        placement: node.placement,
        meta: node.meta,
        hints: node.hints,
        lock: node.lock,
      }),
    );
    if (node.strategy && node.state !== undefined) store.setContainerState(id, node.state);
    store.showNode(id);
    if (node.hidden) store.hideNode(id);
  }
  return store;
}

/**
 * The flat {@link Scenario} for one container of `preset` — the root by
 * default — run at `container` (the preset's viewport by default). Items are
 * projected the way the React layer projects them, hidden children skipped.
 */
export function presetScenario(
  preset: Preset,
  containerId: string = preset.mechanics.id,
  container: Size = preset.viewport,
): Scenario {
  const store = presetToStore(preset);
  const parent = store.getNode(asNodeId(containerId) as NodeId);
  if (!parent?.container) throw new Error(`preset ${preset.id}: ${containerId} is not a container`);
  const items = parent.container.childOrder
    .map((id) => store.getNode(id))
    .filter((n): n is Node => n !== undefined && n.lifecycle.state !== 'hidden')
    .map(nodeToLayoutItem);
  return {
    id: containerId === preset.mechanics.id ? preset.id : `${preset.id}/${containerId}`,
    source: preset.source,
    stress: preset.stress,
    container,
    items,
    options: (parent.container.config ?? {}) as Record<string, unknown>,
    ...(parent.container.state === undefined ? {} : { state: parent.container.state }),
  };
}

/** One row of {@link presetProperties}: a label and the value it reads. */
export interface PresetProperty {
  label: string;
  value: string;
}

const HINT_KEYS = ['minSize', 'maxSize', 'preferredSize', 'sizing'] as const;
const PLACEMENT_KEYS = ['size', 'span', 'pinned'] as const;

/**
 * What a preset exercises, read off its tree rather than written by hand, so
 * it cannot drift from the preset it describes. Rows with nothing to report
 * are left out.
 */
export function presetProperties(preset: Preset): PresetProperty[] {
  const tree = presetTree(preset);
  const all: PresetNode[] = [];
  let depth = 0;
  const measure = (node: PresetNode, d: number) => {
    all.push(node);
    depth = Math.max(depth, d);
    for (const c of node.children ?? []) measure(c, d + 1);
  };
  measure(tree, 0);
  const containers = all.filter((n) => n.strategy);
  const leaves = all.filter((n) => !n.strategy);

  const count = (pred: (n: PresetNode) => boolean) => all.filter(pred).length;
  const rows: PresetProperty[] = [
    { label: 'Viewport', value: `${preset.viewport.w} × ${preset.viewport.h}` },
    {
      label: 'Nodes',
      value: `${all.length} (${containers.length} container${containers.length === 1 ? '' : 's'}, ${leaves.length} pane${leaves.length === 1 ? '' : 's'}), ${depth + 1} level${depth === 0 ? '' : 's'} deep`,
    },
  ];

  const byStrategy = new Map<string, PresetNode[]>();
  for (const c of containers)
    byStrategy.set(c.strategy!, [...(byStrategy.get(c.strategy!) ?? []), c]);
  for (const [strategy, nodes] of byStrategy) {
    const configs = new Map<string, Set<string>>();
    for (const n of nodes) {
      for (const [k, v] of Object.entries(n.config ?? {})) {
        configs.set(k, (configs.get(k) ?? new Set()).add(formatValue(v)));
      }
    }
    const config = [...configs].map(([k, vs]) => `${k} ${[...vs].join(' / ')}`).join(', ');
    rows.push({
      label: `Strategy: ${strategy}`,
      value: `${nodes.length} container${nodes.length === 1 ? '' : 's'}${config ? ` — ${config}` : ''}`,
    });
  }

  for (const key of HINT_KEYS) {
    const n = count((node) => node.hints?.[key] !== undefined);
    if (n > 0) rows.push({ label: `hints.${key}`, value: `${n} node${n === 1 ? '' : 's'}` });
  }
  for (const key of PLACEMENT_KEYS) {
    const n = count((node) => node.placement?.[key] !== undefined);
    if (n > 0) rows.push({ label: `placement.${key}`, value: `${n} node${n === 1 ? '' : 's'}` });
  }
  const extras: [string, (n: PresetNode) => boolean][] = [
    ['Locked', (n) => n.lock !== undefined && n.lock !== false],
    ['Hidden', (n) => n.hidden === true],
    ['Saved strategy state', (n) => n.state !== undefined],
  ];
  for (const [label, pred] of extras) {
    const n = count(pred);
    if (n > 0) rows.push({ label, value: `${n} node${n === 1 ? '' : 's'}` });
  }
  return rows;
}

function formatValue(v: unknown): string {
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
  if (typeof v === 'string' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}
