import { act, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Store, asNodeId, createPanel, createZone } from '../index.js';
import { Provider } from './Provider.js';
import { useActivity } from './hooks.js';

function withStore(store: Store, ui: React.ReactNode) {
  return <Provider store={store}>{ui}</Provider>;
}

describe('useActivity', () => {
  it('returns undefined when no activity is set', () => {
    const store = new Store();
    store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'grid', config: {} }));
    store.registerNode(createPanel({ id: asNodeId('p'), parentId: asNodeId('z') }));
    let observed: Record<string, unknown> | undefined = { sentinel: true };
    function Probe() {
      observed = useActivity(asNodeId('p'));
      return null;
    }
    render(withStore(store, <Probe />));
    expect(observed).toBeUndefined();
  });

  it('returns the activity bag and re-renders on change', async () => {
    const store = new Store();
    store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'grid', config: {} }));
    store.registerNode(createPanel({ id: asNodeId('p'), parentId: asNodeId('z') }));
    const seen: Array<Record<string, unknown> | undefined> = [];
    function Probe() {
      seen.push(useActivity(asNodeId('p')));
      return null;
    }
    render(withStore(store, <Probe />));
    await act(async () => {
      store.patchActivity(asNodeId('p'), { busy: true });
    });
    expect(seen[seen.length - 1]).toEqual({ busy: true });
    await act(async () => {
      store.patchActivity(asNodeId('p'), { busy: undefined });
    });
    expect(seen[seen.length - 1]).toBeUndefined();
  });
});
