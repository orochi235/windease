import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { asNodeId, createNode, Store, stripStrategy } from '../index.js';
import { Container } from './Container.js';
import { Provider } from './Provider.js';
import { StrategyRegistryProvider } from './strategies.js';

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
  const a = asNodeId('a');
  s.registerNode(createNode({ kind: 'panel', focus: true, id: a, parentId: z }));
  s.showNode(a);
  return s;
}

function renderRow() {
  return render(
    <Provider store={makeStore()}>
      <StrategyRegistryProvider strategies={{ strip: stripStrategy as never }}>
        <Container
          parentId={asNodeId('z')}
          chrome={{}}
          viewport={{ w: 200, h: 100 }}
          settleMs={200}
        />
      </StrategyRegistryProvider>
    </Provider>,
  );
}

function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: reduce && q.includes('prefers-reduced-motion'),
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

describe('prefers-reduced-motion', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('drops the settle transition', () => {
    stubReducedMotion(true);
    const { container } = renderRow();
    const child = container.querySelector('[data-node="a"]') as HTMLElement;
    expect(child.style.transition).toBe('');
  });

  it('keeps it when motion is not reduced', () => {
    stubReducedMotion(false);
    const { container } = renderRow();
    const child = container.querySelector('[data-node="a"]') as HTMLElement;
    expect(child.style.transition).toContain('200ms');
  });
});
