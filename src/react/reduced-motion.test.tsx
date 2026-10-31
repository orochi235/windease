import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { asNodeId, createNode, Store, stripStrategy } from '../index.js';
import { Container } from './Container.js';
import { useLayoutContext } from './LayoutContext.js';
import { Provider } from './Provider.js';
import { Panel, Zone } from './presets.js';
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

/** A matchMedia whose reduced-motion answer can be flipped after mount. */
function liveReducedMotion(initial: boolean) {
  let reduce = initial;
  const listeners = new Set<() => void>();
  vi.stubGlobal('matchMedia', (q: string) => ({
    get matches() {
      return reduce && q.includes('prefers-reduced-motion');
    },
    media: q,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  }));
  return (next: boolean) => {
    reduce = next;
    for (const fn of listeners) fn();
  };
}

function SettleProbe({ testId }: { testId: string }) {
  return <output data-testid={testId}>{useLayoutContext().settleMs}</output>;
}

function renderPresets() {
  return render(
    <Provider store={new Store()}>
      <StrategyRegistryProvider strategies={{ strip: stripStrategy as never }}>
        <Zone
          id={asNodeId('z')}
          strategyId="strip"
          config={{ axis: 'x', fill: true }}
          viewport={{ w: 200, h: 100 }}
          settleMs={200}
        >
          <Panel
            id={asNodeId('p')}
            container={{ strategyId: 'strip', config: { axis: 'y', fill: true } }}
            settleMs={300}
          >
            <Panel id={asNodeId('q')} />
            <SettleProbe testId="panel-settle" />
          </Panel>
          <SettleProbe testId="zone-settle" />
        </Zone>
      </StrategyRegistryProvider>
    </Provider>,
  );
}

describe('prefers-reduced-motion, followed live', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('drops a Container transition when the preference turns on after mount', () => {
    const flip = liveReducedMotion(false);
    const { container } = renderRow();
    const child = () => container.querySelector('[data-node="a"]') as HTMLElement;
    expect(child().style.transition).toContain('200ms');
    act(() => flip(true));
    expect(child().style.transition).toBe('');
  });

  it('drops the settle time a Zone and a laid-out Panel hand their children', () => {
    const flip = liveReducedMotion(false);
    const { getByTestId } = renderPresets();
    expect(getByTestId('zone-settle').textContent).toBe('200');
    expect(getByTestId('panel-settle').textContent).toBe('300');
    act(() => flip(true));
    expect(getByTestId('zone-settle').textContent).toBe('0');
    expect(getByTestId('panel-settle').textContent).toBe('0');
  });
});
