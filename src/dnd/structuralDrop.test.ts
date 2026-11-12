import { describe, expect, it } from 'vitest';
import { asNodeId, createNode, Store } from '../index.js';
import { dropSplit } from './structuralDrop.js';

const id = asNodeId;
const STACK = { headerSize: 24, show: 'dropped' };

/** Row `z` with `drop.wrap` holding stack `sa` › `a`, plus panel `p` and stack `sq` › `q` in `other`. */
function buildStore(wrap: Record<string, unknown> | undefined): Store {
  const s = new Store();
  s.registerNode(
    createNode({
      kind: 'zone',
      id: id('z'),
      container: {
        strategyId: 'strip',
        config: { axis: 'x', drop: { split: true, ...(wrap ? { wrap } : {}) } },
      },
    }),
  );
  s.registerNode(
    createNode({ kind: 'zone', id: id('other'), container: { strategyId: 'strip', config: {} } }),
  );
  const add = (nid: string, parentId: string, container?: Record<string, unknown>) => {
    s.registerNode(
      createNode({
        kind: container ? 'group' : 'panel',
        id: id(nid),
        parentId: id(parentId),
        ...(container ? { container: container as never } : {}),
      }),
    );
    s.showNode(id(nid));
  };
  add('sa', 'z', { strategyId: 'stack', config: STACK });
  add('a', 'sa');
  add('p', 'other');
  add('sq', 'other', { strategyId: 'stack', config: STACK });
  add('q', 'sq');
  return s;
}

const order = (s: Store, nid: string) => s.getContainerView(id(nid))?.childOrder ?? [];

function split(s: Store, draggingId: string): void {
  let n = 0;
  dropSplit(s, {
    draggingId: id(draggingId),
    targetId: id('z'),
    ontoId: id('sa'),
    axis: 'y',
    edge: 'end',
    id: id('g1'),
    wrapId: () => id(`w${++n}`),
    splitConfig: undefined,
  });
}

describe('dropSplit under drop.wrap', () => {
  const wrap = { strategyId: 'stack', config: STACK, autoPrune: true, allowsPinning: false };

  it('puts the dropped pane in a new container of that shape, in its slot', () => {
    const s = buildStore(wrap);
    split(s, 'p');
    expect(order(s, 'g1')).toEqual([id('sa'), id('w1')]);
    expect(order(s, 'w1')).toEqual([id('p')]);
    const w = s.getNode(id('w1'));
    expect(w?.kind).toBe('group');
    expect(w?.container).toMatchObject({
      strategyId: 'stack',
      config: { ...STACK, activeId: 'p' },
      autoPrune: true,
      allowsPinning: false,
    });
    expect(w?.lifecycle.state).toBe('visible');
  });

  it('places a node that already has the strategy as it is', () => {
    const s = buildStore(wrap);
    split(s, 'sq');
    expect(order(s, 'g1')).toEqual([id('sa'), id('sq')]);
    expect(s.getNode(id('w1'))).toBeUndefined();
  });

  it('leaves the pane bare with no wrap', () => {
    const s = buildStore(undefined);
    split(s, 'p');
    expect(order(s, 'g1')).toEqual([id('sa'), id('p')]);
  });

  it('is one transaction, so one undo step', () => {
    const s = buildStore(wrap);
    const labels: string[] = [];
    s.events.on('transaction.begin', (e: { label?: string }) => labels.push(e.label ?? ''));
    split(s, 'p');
    expect(labels).toEqual(['splitDrop']);
  });

  it('carries drop.wrap into the strip it creates, so a later split there wraps too', () => {
    const s = buildStore(wrap);
    split(s, 'p');
    expect(s.getContainerView(id('g1'))?.config).toMatchObject({ drop: { split: true, wrap } });
  });
});
