import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { asNodeId, createNode, Store, stripStrategy } from '../index.js';
import { Container } from './Container.js';
import { useLayoutContext } from './LayoutContext.js';
import { Provider } from './Provider.js';
import { Panel, Zone } from './presets.js';
import { ResizeGestureContext } from './resize-gesture.js';
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

function renderContainer(resizing: boolean) {
  return render(
    <Provider store={makeStore()}>
      <StrategyRegistryProvider strategies={{ strip: stripStrategy as never }}>
        <ResizeGestureContext.Provider value={resizing}>
          <Container
            parentId={asNodeId('z')}
            chrome={{}}
            viewport={{ w: 200, h: 100 }}
            settleMs={200}
          />
        </ResizeGestureContext.Provider>
      </StrategyRegistryProvider>
    </Provider>,
  );
}

function renderZone(resizing: boolean) {
  return render(
    <Provider store={new Store()}>
      <StrategyRegistryProvider strategies={{ strip: stripStrategy as never }}>
        <ResizeGestureContext.Provider value={resizing}>
          <Zone
            id={asNodeId('z')}
            strategyId="strip"
            config={{ axis: 'x', fill: true }}
            viewport={{ w: 200, h: 100 }}
            settleMs={200}
          >
            <Panel id={asNodeId('a')} />
            <SettleProbe />
          </Zone>
        </ResizeGestureContext.Provider>
      </StrategyRegistryProvider>
    </Provider>,
  );
}

const child = (root: HTMLElement) => root.querySelector('[data-node="a"]') as HTMLElement;

/** Reports the settle time a Zone hands the children it places. */
function SettleProbe() {
  return <output data-testid="settle">{useLayoutContext().settleMs}</output>;
}

const settleOf = (root: HTMLElement) => root.querySelector('[data-testid="settle"]')?.textContent;

describe('a container inside one being resized by a drag', () => {
  it('drops its settle transition, since the pointer is the motion', () => {
    expect(child(renderContainer(true).container).style.transition).toBe('');
  });

  it('keeps it when no ancestor is resizing', () => {
    expect(child(renderContainer(false).container).style.transition).toContain('200ms');
  });

  it('drops it in a declarative Zone too', () => {
    expect(settleOf(renderZone(true).container)).toBe('0');
  });

  it('keeps it in a declarative Zone when no ancestor is resizing', () => {
    expect(settleOf(renderZone(false).container)).toBe('200');
  });
});
