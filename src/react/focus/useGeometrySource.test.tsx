import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { asNodeId, createNode, type GeometrySource, Store, stripStrategy } from '../../index.js';
import { Container } from '../Container.js';
import { Provider } from '../Provider.js';
import { StrategyRegistryProvider } from '../strategies.js';
import { GeometryProvider, useGeometrySource } from './useGeometrySource.js';

function makeStore(): Store {
  const s = new Store();
  const z = asNodeId('z');
  s.registerNode(
    createNode({
      kind: 'zone',
      container: { strategyId: 'strip', config: { axis: 'x', fill: true } },
      id: z,
    }),
  );
  s.showNode(z);
  for (const c of ['a', 'b']) {
    const nid = asNodeId(c);
    s.registerNode(createNode({ kind: 'panel', focus: true, id: nid, parentId: z }));
    s.showNode(nid);
  }
  return s;
}

/** Hands the source out so the test can read it after mount, the way a keydown
 *  handler does. A render-phase read is always empty: `<Container>` fills the
 *  registry from an effect, and nothing re-renders a reader when it does. */
function Probe({ onSource }: { onSource: (g: GeometrySource) => void }) {
  onSource(useGeometrySource());
  return null;
}

function mount() {
  const store = makeStore();
  let geometry: GeometrySource | null = null;
  render(
    <Provider store={store}>
      <StrategyRegistryProvider strategies={{ strip: stripStrategy as never }}>
        <GeometryProvider>
          <Container parentId={asNodeId('z')} chrome={{}} viewport={{ w: 200, h: 100 }} />
          <Probe
            onSource={(g) => {
              geometry = g;
            }}
          />
        </GeometryProvider>
      </StrategyRegistryProvider>
    </Provider>,
  );
  if (!geometry) throw new Error('Probe never rendered');
  return geometry as GeometrySource;
}

describe('useGeometrySource', () => {
  it('reports a rect for every placed child', () => {
    const geometry = mount();
    expect(geometry.rectOf(asNodeId('a'))?.w).toBeGreaterThan(0);
    expect(geometry.rectOf(asNodeId('b'))?.w).toBeGreaterThan(0);
  });

  it('lays the two children of a 200px row side by side', () => {
    const geometry = mount();
    const a = geometry.rectOf(asNodeId('a'));
    const b = geometry.rectOf(asNodeId('b'));
    if (!a || !b) throw new Error('both children should be placed');
    expect(b.x).toBeGreaterThanOrEqual(a.x + a.w);
  });

  it('reports null for a node nobody placed', () => {
    const geometry = mount();
    expect(geometry.rectOf(asNodeId('nope'))).toBeNull();
  });
});
