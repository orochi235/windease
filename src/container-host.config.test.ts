import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNode } from './constructors.js';
import { ContainerHost } from './container-host.js';
import { asNodeId, Store } from './index.js';
import { gridStrategy } from './layout/grid.js';
import { stripStrategy } from './layout/strip.js';
import { configureTrace } from './trace.js';

const Z = asNodeId('z');

function hostWith(config: Record<string, unknown>) {
  const store = new Store();
  store.registerNode(
    createNode({ kind: 'zone', id: Z, container: { strategyId: 'strip', config } }),
  );
  const p = asNodeId('p');
  store.registerNode(createNode({ kind: 'panel', focus: true, id: p, parentId: Z }));
  store.showNode(p);
  const host = new ContainerHost(store, Z, new Map([['strip', stripStrategy as never]]));
  host.setViewport({ w: 200, h: 100 });
  return { store, host };
}

/** The config bag reaches a strategy untyped, so a typo cannot be caught by
 *  the compiler. It has to be caught at the one place the host and the
 *  strategy meet. */
describe('ContainerHost — config problems', () => {
  let logged: string[];

  beforeEach(() => {
    logged = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
    });
    configureTrace('layout');
  });

  afterEach(() => {
    configureTrace(null);
    vi.restoreAllMocks();
  });

  it('traces a misspelled enum value', () => {
    const { host } = hostWith({ axis: 'x', resizeMode: 'neighbour' });
    host.layout();
    expect(logged.join('\n')).toContain('resizeMode');
  });

  it('traces an unknown key with a suggestion', () => {
    const { host } = hostWith({ axsi: 'x' });
    host.layout();
    const line = logged.find((l) => l.includes('axsi')) ?? '';
    expect(line).toContain('axis');
  });

  it('says nothing about a config that is fine', () => {
    const { host } = hostWith({ axis: 'y', gap: 8, fill: true });
    host.layout();
    expect(logged.join('\n')).not.toContain('config');
  });

  it('reports once, not on every layout', () => {
    const { host } = hostWith({ axsi: 'x' });
    host.layout();
    host.layout();
    host.layout();
    expect(logged.filter((l) => l.includes('axsi'))).toHaveLength(1);
  });

  it('reports again when the config actually changes', () => {
    const { store, host } = hostWith({ axsi: 'x' });
    host.layout();
    store.updateContainerConfig(Z, { axsi: undefined, wobble: 1 });
    host.layout();
    expect(logged.filter((l) => l.includes('wobble'))).toHaveLength(1);
  });
});

/** `cols` and `maxCols` are both valid numbers, so nothing in `configSpec`
 *  objects to a config carrying both — and grid then reads one and silently
 *  drops the other. */
describe('ContainerHost — conflicting config keys', () => {
  let logged: string[];

  beforeEach(() => {
    logged = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
    });
    configureTrace('layout');
  });

  afterEach(() => {
    configureTrace(null);
    vi.restoreAllMocks();
  });

  function gridHost(config: Record<string, unknown>) {
    const store = new Store();
    store.registerNode(
      createNode({ kind: 'zone', id: Z, container: { strategyId: 'grid', config } }),
    );
    const p = asNodeId('p');
    store.registerNode(createNode({ kind: 'panel', focus: true, id: p, parentId: Z }));
    store.showNode(p);
    const host = new ContainerHost(store, Z, new Map([['grid', gridStrategy as never]]));
    host.setViewport({ w: 200, h: 100 });
    return host;
  }

  it('traces the cap grid silently ignores', () => {
    gridHost({ cols: 2, maxCols: 4 }).layout();
    expect(logged.join('\n')).toContain("'maxCols' is ignored when 'cols' is set");
  });

  it('traces a fixed row count that a fixed column count shadows', () => {
    gridHost({ cols: 2, rows: 3 }).layout();
    expect(logged.join('\n')).toContain("'rows' is ignored when 'cols' is set");
  });

  it('says nothing about a config that sets only one of a conflicting pair', () => {
    gridHost({ cols: 2, gap: 8 }).layout();
    expect(logged.join('\n')).not.toContain('ignored');
  });
});
