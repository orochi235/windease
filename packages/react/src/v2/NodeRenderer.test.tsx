import { render } from '@testing-library/react';
import { WindeaseNodeStore, asNodeId, createPanel, createZone } from '@windease/core';
import { describe, expect, it } from 'vitest';
import { type ChromeMap, WindeaseNodeRoot } from './NodeRenderer.js';

const chrome: ChromeMap = {
  zone: ({ node, children }) => (
    <div data-testid={`zone-${node.id}`} data-kind="zone">
      {children}
    </div>
  ),
  panel: ({ node, children }) => (
    <div data-testid={`panel-${node.id}`} data-kind="panel">
      <span>{String(node.meta?.title ?? '')}</span>
      {children}
    </div>
  ),
  group: ({ node, children }) => (
    <div data-testid={`group-${node.id}`} data-kind="group">
      {children}
    </div>
  ),
};

describe('WindeaseNodeRoot', () => {
  it('renders a zone with two panels via chrome dispatch', () => {
    const store = new WindeaseNodeStore();
    store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'stack', config: {} }));
    store.registerNode(
      createPanel({ id: asNodeId('a'), parentId: asNodeId('z'), meta: { title: 'A' } }),
    );
    store.registerNode(
      createPanel({ id: asNodeId('b'), parentId: asNodeId('z'), meta: { title: 'B' } }),
    );
    const { getByTestId } = render(<WindeaseNodeRoot store={store} chrome={chrome} />);
    expect(getByTestId('zone-z')).toBeDefined();
    expect(getByTestId('panel-a').textContent).toContain('A');
    expect(getByTestId('panel-b').textContent).toContain('B');
  });

  it('recursive panel renders children inside its chrome', () => {
    const store = new WindeaseNodeStore();
    store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'stack', config: {} }));
    store.registerNode(
      createPanel({
        id: asNodeId('tray'),
        parentId: asNodeId('z'),
        meta: { title: 'Tray' },
        container: { strategyId: 'stack', config: {} },
      }),
    );
    store.registerNode(
      createPanel({ id: asNodeId('leaf'), parentId: asNodeId('tray'), meta: { title: 'Leaf' } }),
    );
    const { getByTestId } = render(<WindeaseNodeRoot store={store} chrome={chrome} />);
    const tray = getByTestId('panel-tray');
    expect(tray).toBeDefined();
    expect(tray.textContent).toContain('Leaf');
  });

  it('hidden nodes do not render', () => {
    const store = new WindeaseNodeStore();
    store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'stack', config: {} }));
    store.registerNode(createPanel({ id: asNodeId('a'), parentId: asNodeId('z') }));
    store.registerNode(createPanel({ id: asNodeId('b'), parentId: asNodeId('z') }));
    store.showNode(asNodeId('a'));
    store.showNode(asNodeId('b'));
    store.hideNode(asNodeId('b'));
    const { queryByTestId } = render(<WindeaseNodeRoot store={store} chrome={chrome} />);
    expect(queryByTestId('panel-a')).not.toBeNull();
    expect(queryByTestId('panel-b')).toBeNull();
  });
});
