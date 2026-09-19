import { createNode } from './constructors.js';
import {
  CapabilityMissingError,
  DuplicateNodeError,
  InvariantViolationError,
  LockedError,
  NodeNotFoundError,
  NoSpaceError,
} from './errors.js';
import type { Size } from './layout-types.js';
import type { NodeId } from './node.js';
import {
  columnsShortfall,
  gridShortfall,
  rowShortfall,
  type SplitShortfall,
  type SplitSpacing,
} from './split-fit.js';
import type { SplitInput, SplitStrict } from './split-types.js';
import type { MutateOptions, Store } from './store.js';
import { trace } from './trace.js';

export type SplitMode = 'wrap' | 'flatten' | 'reconfigure';

/** Total children the split produces, including the target. */
function totalChildren(input: SplitInput): number {
  if (input.direction === 'both') return input.into[0] * input.into[1];
  if (input.direction === 'grid') return input.into;
  return input.into ?? 2;
}

/** Ids this call will actually register, which depends on the mode: a
 *  `groupId` is unused when flattening or reconfiguring. */
function mintedIds(input: SplitInput, mode: SplitMode): NodeId[] {
  if (input.direction === 'both') {
    const groups = mode === 'reconfigure' ? input.groupIds.slice(1) : [...input.groupIds];
    return [...groups, ...input.newIds];
  }
  const group = mode === 'wrap' && input.groupId ? [input.groupId] : [];
  return [...group, ...input.newIds];
}

export function resolveMode(store: Store, id: NodeId, input: SplitInput): SplitMode {
  const node = store.getNodeTruth(id);
  if (!node?.membership) return 'reconfigure';
  if (input.direction === 'x' || input.direction === 'y') {
    const parent = store.getNodeTruth(node.membership.parentId);
    const cfg = parent?.container?.config as { axis?: string } | undefined;
    if (parent?.container?.strategyId === 'strip' && (cfg?.axis ?? 'x') === input.direction) {
      return 'flatten';
    }
  }
  return 'wrap';
}

export function validateSplit(store: Store, id: NodeId, input: SplitInput): SplitMode {
  if (!store.getNodeTruth(id)) {
    throw new NodeNotFoundError(id);
  }

  const mode = resolveMode(store, id, input);

  const total = totalChildren(input);
  if (input.direction === 'both') {
    const [cols, rows] = input.into;
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1) {
      throw new InvariantViolationError(
        'split-arity',
        `into must be two positive integers, got [${cols}, ${rows}]`,
        { into: input.into },
      );
    }
  }
  if (total < 2 || !Number.isInteger(total)) {
    throw new InvariantViolationError(
      'split-arity',
      `into must produce at least 2 children, got ${total}`,
      { into: input.into },
    );
  }
  if (input.newIds.length !== total - 1) {
    throw new InvariantViolationError(
      'split-arity',
      `newIds must have ${total - 1} entries for a split into ${total}, got ${input.newIds.length}`,
      { expected: total - 1, actual: input.newIds.length },
    );
  }

  const minted = mintedIds(input, mode);
  const seen = new Set<NodeId>();
  for (const mid of minted) {
    if (seen.has(mid)) {
      throw new DuplicateNodeError(mid);
    }
    seen.add(mid);
    if (store.getNodeTruth(mid)) throw new DuplicateNodeError(mid);
  }

  // 'both' needs its column groups validated in every mode, not only wrap.
  if (input.direction === 'both') {
    const needed = 1 + input.into[0];
    if (input.groupIds.length !== needed) {
      throw new InvariantViolationError(
        'split-missing-group-id',
        `direction 'both' into [${input.into[0]}, ${input.into[1]}] needs ${needed} groupIds, got ${input.groupIds.length}`,
        { expected: needed, actual: input.groupIds.length },
      );
    }
  } else if (mode === 'wrap' && !input.groupId) {
    throw new InvariantViolationError(
      'split-missing-group-id',
      `split of ${id} wraps it in a new group and needs a groupId`,
      { id },
    );
  }
  return mode;
}

/** Strip config for an axis, with the caller's config merged over it.
 *  `fill` defaults on: strip's own default is off, which sizes hintless
 *  children to zero — right for a toolbar, wrong for a split pane. */
function stripConfig(axis: 'x' | 'y', extra?: Record<string, unknown>): Record<string, unknown> {
  return { axis, fill: true, ...extra };
}

/** Grid config with the caller's config merged over it; `cols` omitted when unset. */
function gridConfig(
  cols: number | undefined,
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  return cols === undefined ? { ...extra } : { cols, ...extra };
}

/** A `split`-interposed group is a parented zone with `kind: 'group'`, so
 *  consumer `ChromeMap`s dispatching on that kind still fire. */
function registerGroup(
  store: Store,
  input: {
    id: NodeId;
    parentId: NodeId;
    strategyId: string;
    config: unknown;
    placement?: Record<string, unknown> | undefined;
    allowsPinning?: boolean | undefined;
  },
): void {
  const node = createNode({
    id: input.id,
    parentId: input.parentId,
    container: {
      strategyId: input.strategyId,
      config: input.config,
      allowsPinning: input.allowsPinning,
    },
    placement: input.placement,
    kind: 'group',
  });
  store.registerNode(node);
}

/** Give `id` a container with `strategyId`/`config`, whether it had one already.
 *  Skips the redundant setStrategy/updateContainerConfig writes when
 *  `ensureContainer` just created the container with this exact config. */
function becomeContainer(
  store: Store,
  id: NodeId,
  strategyId: string,
  config: Record<string, unknown>,
): void {
  const hadContainer = store.getNodeTruth(id)?.container !== undefined;
  store.ensureContainer(id, strategyId, config);
  if (hadContainer) {
    store.setStrategy(id, strategyId);
    store.updateContainerConfig(id, config);
  }
}

/** Build the nested column groups for `direction: 'both'` under `outerId`,
 *  with `id` already sitting at column 0 row 0. */
function buildColumns(
  store: Store,
  id: NodeId,
  outerId: NodeId,
  columnIds: readonly NodeId[],
  newIds: readonly NodeId[],
  rows: number,
  extra: Record<string, unknown> | undefined,
): void {
  let cursor = 0;
  columnIds.forEach((columnId, col) => {
    registerGroup(store, {
      id: columnId,
      parentId: outerId,
      strategyId: 'strip',
      config: stripConfig('y', extra),
    });
    store.showNode(columnId);
    for (let row = 0; row < rows; row += 1) {
      if (col === 0 && row === 0) {
        store.moveNode(id, columnId, 0);
        store.patchPlacement(id, { size: undefined, share: undefined });
        store.unpin(id);
        continue;
      }
      const newId = newIds[cursor];
      cursor += 1;
      if (newId === undefined) {
        throw new InvariantViolationError(
          'split-invariant',
          `buildColumns ran out of newIds at col ${col} row ${row}; validateSplit should have caught this`,
          { col, row },
        );
      }
      store.registerNode(
        createNode({
          kind: 'panel',
          focus: true,
          id: newId,
          parentId: columnId,
        }),
      );
      store.showNode(newId);
    }
  });
}

/** Lock axes `split` enforces itself. Internal calls then run suspended, so a
 *  guard on a public method cannot fire partway and leave a half-built tree. */
function assertSplitUnlocked(store: Store, id: NodeId, mode: SplitMode, force: boolean): void {
  if (force) return;
  const node = store.getNodeTruth(id);
  const check = (target: NodeId, axis: 'move' | 'arrange' | 'dragOut') => {
    if (store.isLocked(target, axis)) {
      throw new LockedError(target, axis, 'split');
    }
  };
  if (mode === 'reconfigure') {
    check(id, 'arrange');
    return;
  }
  const parentId = node?.membership?.parentId;
  if (!parentId) return;
  if (mode === 'flatten') {
    check(parentId, 'arrange');
    return;
  }
  check(id, 'move');
  check(parentId, 'dragOut');
  check(parentId, 'arrange');
}

/** Lock axes `unsplit` enforces itself, checked up front so an internal
 *  guard cannot fire partway through `withLocksSuspended`. */
function assertUnsplitUnlocked(
  store: Store,
  groupId: NodeId,
  parentId: NodeId,
  force: boolean,
): void {
  if (force) return;
  for (const axis of ['destroy', 'dragOut'] as const) {
    if (store.isLocked(groupId, axis)) throw new LockedError(groupId, axis, 'unsplit');
  }
  if (store.isLocked(parentId, 'arrange')) throw new LockedError(parentId, 'arrange', 'unsplit');
}

/** The larger of each axis. */
function floorOf(...sizes: (Partial<Size> | undefined)[]): Size {
  return {
    w: Math.max(0, ...sizes.map((s) => s?.w ?? 0)),
    h: Math.max(0, ...sizes.map((s) => s?.h ?? 0)),
  };
}

function spacingOf(config: Record<string, unknown> | undefined): SplitSpacing {
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
  return { gap: n(config?.gap), padding: n(config?.padding) };
}

/** Throw when a strict split's panes would not fit their floors. */
function assertSplitFits(
  store: Store,
  id: NodeId,
  input: SplitInput,
  mode: SplitMode,
  strict: SplitStrict,
): void {
  const newFloor = floorOf(strict.minSize);
  const floors = [
    floorOf(store.getNodeTruth(id)?.hints?.minSize, strict.minSize),
    ...input.newIds.map(() => newFloor),
  ];
  let short: SplitShortfall | null;
  if (input.direction === 'both') {
    const [cols, rows] = input.into;
    const columns = Array.from({ length: cols }, (_, c) => floors.slice(c * rows, (c + 1) * rows));
    short = columnsShortfall(strict.size, columns, spacingOf(input.config));
  } else if (input.direction === 'grid') {
    const cols = input.cols ?? Math.ceil(Math.sqrt(floors.length));
    short = gridShortfall(strict.size, cols, floors, spacingOf(input.config));
  } else {
    // Flattened panes join the parent's row, so its gap separates them; the
    // slot they divide has no padding of its own.
    const parentId = store.getNodeTruth(id)?.membership?.parentId;
    const spacing =
      mode === 'flatten'
        ? {
            gap: spacingOf(
              store.getNodeTruth(parentId as NodeId)?.container?.config as Record<string, unknown>,
            ).gap,
            padding: 0,
          }
        : spacingOf(input.config);
    short = rowShortfall(strict.size, input.direction, floors, spacing);
  }
  if (short) refuse(id, 'split', short);
}

function refuse(id: NodeId, operation: string, short: SplitShortfall): never {
  trace(
    'store',
    `${operation}: ${id} refused, needs ${short.needed}px on ${short.axis}, has ${short.available}`,
  );
  throw new NoSpaceError(id, operation, short.axis, short.needed, short.available);
}

/** Throw when `splitInto` under `strict` would leave either pane below its floor
 *  in the slot `ontoId` holds. */
export function assertSplitIntoFits(
  store: Store,
  sourceId: NodeId,
  ontoId: NodeId,
  axis: 'x' | 'y',
  config: Record<string, unknown> | undefined,
  strict: SplitStrict,
): void {
  const floor = (nid: NodeId) => floorOf(store.getNodeTruth(nid)?.hints?.minSize, strict.minSize);
  const short = rowShortfall(
    strict.size,
    axis,
    [floor(sourceId), floor(ontoId)],
    spacingOf(config),
  );
  if (short) refuse(ontoId, 'splitInto', short);
}

export function splitNode(store: Store, id: NodeId, input: SplitInput): void {
  const mode = validateSplit(store, id, input);
  assertSplitUnlocked(store, id, mode, input.force === true);
  if (input.strict) assertSplitFits(store, id, input, mode, input.strict);

  store.transact(() => {
    store.withLocksSuspended(() => {
      if (mode === 'flatten') {
        applyFlatten(store, id, input);
      } else if (mode === 'wrap') {
        applyWrap(store, id, input);
      } else {
        applyReconfigure(store, id, input);
      }
    });
  }, 'split');
}

function applyFlatten(store: Store, id: NodeId, input: SplitInput): void {
  const node = store.getNodeTruth(id);
  const parentId = node?.membership?.parentId;
  if (!parentId) {
    throw new InvariantViolationError(
      'split-invariant',
      `flatten requires membership on ${id}; resolveMode should have chosen wrap or reconfigure`,
      { id },
    );
  }
  const order = store.getContainerView(parentId)?.childOrder ?? [];
  let at = order.indexOf(id);
  for (const newId of input.newIds) {
    at += 1;
    store.registerNode(
      createNode({
        kind: 'panel',
        focus: true,
        id: newId,
        parentId,
      }),
    );
    store.reorderInParent(newId, at);
    store.showNode(newId);
  }
  trace(
    'store',
    `split: flatten ${id} → ${parentId}@${order.indexOf(id)} (${input.direction}, +${input.newIds.length})`,
  );
}

function applyWrap(store: Store, id: NodeId, input: SplitInput): void {
  const node = store.getNodeTruth(id);
  const parentId = node?.membership?.parentId;
  const groupId = input.direction === 'both' ? input.groupIds[0] : input.groupId;
  if (!parentId || !groupId) {
    throw new InvariantViolationError(
      'split-invariant',
      `wrap requires a parent and a groupId for ${id}; validateSplit should have caught this`,
      { id },
    );
  }

  const order = store.getContainerView(parentId)?.childOrder ?? [];
  const at = order.indexOf(id);
  const placement = { ...(node?.membership?.placement ?? {}) };
  const pinned = store.getPinnedIndex(id);
  delete placement.pinned;

  const outerConfig =
    input.direction === 'both'
      ? stripConfig('x', input.config)
      : input.direction === 'grid'
        ? gridConfig(input.cols, input.config)
        : stripConfig(input.direction, input.config);

  registerGroup(store, {
    id: groupId,
    parentId,
    strategyId: input.direction === 'grid' ? 'grid' : 'strip',
    config: outerConfig,
    placement,
  });
  store.showNode(groupId);
  store.reorderInParent(groupId, at);

  if (input.direction === 'both') {
    buildColumns(
      store,
      id,
      groupId,
      input.groupIds.slice(1),
      input.newIds,
      input.into[1],
      input.config,
    );
  } else {
    store.moveNode(id, groupId, 0);
    store.patchPlacement(id, { size: undefined, share: undefined });
    store.unpin(id);
    for (const newId of input.newIds) {
      store.registerNode(
        createNode({
          kind: 'panel',
          focus: true,
          id: newId,
          parentId: groupId,
        }),
      );
      store.showNode(newId);
    }
  }
  if (pinned !== null) store.setPinned(groupId, pinned);

  trace(
    'store',
    `split: wrap ${id} → ${groupId}@${at} (${input.direction}, ${input.newIds.length + 1} children)`,
  );
}

function applyReconfigure(store: Store, id: NodeId, input: SplitInput): void {
  if (input.direction === 'both') {
    const config = stripConfig('x', input.config);
    becomeContainer(store, id, 'strip', config);
    let cursor = 0;
    for (const columnId of input.groupIds.slice(1)) {
      registerGroup(store, {
        id: columnId,
        parentId: id,
        strategyId: 'strip',
        config: stripConfig('y', input.config),
      });
      store.showNode(columnId);
      for (let row = 0; row < input.into[1]; row += 1) {
        const newId = input.newIds[cursor];
        cursor += 1;
        if (newId === undefined) break;
        store.registerNode(
          createNode({
            kind: 'panel',
            focus: true,
            id: newId,
            parentId: columnId,
          }),
        );
        store.showNode(newId);
      }
    }
    trace('store', `split: reconfigure ${id} (both ${input.into[0]}x${input.into[1]})`);
    return;
  }

  const strategyId = input.direction === 'grid' ? 'grid' : 'strip';
  const config =
    input.direction === 'grid'
      ? gridConfig(input.cols, input.config)
      : stripConfig(input.direction, input.config);
  becomeContainer(store, id, strategyId, config);
  for (const newId of input.newIds) {
    store.registerNode(
      createNode({
        kind: 'panel',
        focus: true,
        id: newId,
        parentId: id,
      }),
    );
    store.showNode(newId);
  }
  trace(
    'store',
    `split: reconfigure ${id} (${strategyId} ${input.direction}, +${input.newIds.length})`,
  );
}

/** Dissolve `groupId` into its parent: its children move up to the group's
 *  index in order, then the group is unregistered. A sole surviving child
 *  inherits the group's placement (the slot it now occupies); with several
 *  children there is no single right owner, so the group's placement is dropped. */
export function unsplitNode(store: Store, groupId: NodeId, opts?: MutateOptions): void {
  const group = store.getNodeTruth(groupId);
  if (!group) {
    throw new NodeNotFoundError(groupId);
  }
  if (!group.container) throw new CapabilityMissingError(groupId, 'container', 'unsplit');
  if (!group.membership) throw new CapabilityMissingError(groupId, 'membership', 'unsplit');

  const parentId = group.membership.parentId;
  assertUnsplitUnlocked(store, groupId, parentId, opts?.force === true);

  const children = [...group.container.childOrder];
  const at = store.getContainerView(parentId)?.childOrder.indexOf(groupId) ?? 0;
  const groupPlacement = { ...group.membership.placement };
  const groupPinnedIndex = store.getPinnedIndex(groupId);

  store.transact(() => {
    store.withLocksSuspended(() => {
      children.forEach((childId, i) => {
        store.moveNode(childId, parentId, at + i);
      });
      if (children.length === 1 && children[0] !== undefined) {
        const childId = children[0];
        const { pinned: _pinned, ...rest } = groupPlacement;
        if (Object.keys(rest).length > 0) store.patchPlacement(childId, rest);
        if (groupPinnedIndex !== null) store.setPinned(childId, groupPinnedIndex);
      }
      store.unregisterNode(groupId);
    });
  }, 'unsplit');

  trace('store', `unsplit: ${groupId} → ${parentId}@${at} (${children.length} children)`);
}
