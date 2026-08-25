import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { asNodeId, createNode, Store, stripStrategy } from '../../index.js';
import { Container } from '../Container.js';
import { Provider } from '../Provider.js';
import { StrategyRegistryProvider } from '../strategies.js';
import { DragHandle } from './DragHandle.js';
import { DragProvider } from './DragProvider.js';

afterEach(cleanup);

const Z = asNodeId('z');

/**
 * A handle the browser is allowed to drag natively takes the pointer gesture
 * away mid-drag — WebKit stops delivering `pointermove`, `pointerup` and
 * `pointercancel` alike, so the drag freezes and never ends. jsdom dispatches
 * no native drag of its own, so this asserts the refusal rather than the
 * symptom.
 */
function expectsRefusesNativeDrag(el: HTMLElement): void {
  expect(el.getAttribute('draggable')).toBe('false');
  const dragStart = new Event('dragstart', { bubbles: true, cancelable: true });
  fireEvent(el, dragStart);
  expect(dragStart.defaultPrevented).toBe(true);
}

describe('a pointer-driven handle refuses the browser its own drag', () => {
  it('DragHandle', () => {
    const store = new Store();
    store.registerNode(createNode({ kind: 'panel', id: asNodeId('p'), focus: true }));
    const { getByTestId } = render(
      <Provider store={store}>
        <DragProvider>
          <DragHandle nodeId={asNodeId('p')}>
            <span data-testid="grip">grip</span>
          </DragHandle>
        </DragProvider>
      </Provider>,
    );
    const handle = getByTestId('grip').parentElement as HTMLElement;
    expect(handle.getAttribute('data-windease-drag-handle')).toBe('p');
    expectsRefusesNativeDrag(handle);
  });

  it('an affordance hit area', () => {
    const store = new Store();
    store.registerNode(
      createNode({
        kind: 'zone',
        container: { strategyId: 'strip', config: { axis: 'y', resizeMode: 'neighbor' } },
        id: Z,
      }),
    );
    store.showNode(Z);
    for (const c of ['a', 'b']) {
      const nid = asNodeId(c);
      store.registerNode(
        createNode({ kind: 'panel', id: nid, parentId: Z, hints: { minSize: { w: 0, h: 20 } } }),
      );
      store.showNode(nid);
      store.patchPlacement(nid, { size: { h: 100 } });
    }
    const { container } = render(
      <Provider store={store}>
        <StrategyRegistryProvider strategies={{ strip: stripStrategy as never }}>
          <Container parentId={Z} chrome={{}} viewport={{ w: 200, h: 400 }} affordances />
        </StrategyRegistryProvider>
      </Provider>,
    );
    const hit = container.querySelector('.windease-affordance-hit') as HTMLElement;
    expect(hit).not.toBeNull();
    expectsRefusesNativeDrag(hit);
  });
});
