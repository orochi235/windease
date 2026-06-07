import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Store, asNodeId, gridStrategy } from '../index.js';
import { DragProvider } from './dnd/DragProvider.js';
import { Provider } from './Provider.js';
import { Panel, Zone } from './presets.js';
import { StrategyRegistryProvider } from './strategies.js';

afterEach(cleanup);

describe('declarative DnD opt-in props', () => {
  it('Panel with draggable wraps its children in a DragHandle span', () => {
    const store = new Store();
    const { container } = render(
      <Provider store={store}>
        <StrategyRegistryProvider strategies={{ grid: gridStrategy }}>
          <DragProvider>
            <Zone
              id={asNodeId('z')}
              strategyId="grid"
              config={{ cols: 1 }}
              viewport={{ w: 200, h: 200 }}
            >
              <Panel id={asNodeId('p1')} draggable data-testid="p1">
                <div data-testid="p1-content">hello</div>
              </Panel>
            </Zone>
          </DragProvider>
        </StrategyRegistryProvider>
      </Provider>,
    );
    // DragHandle renders a <span> with pointer event handlers. The panel
    // wrapper div (data-testid="p1") should contain a direct child <span>
    // wrapping our content.
    const panel = container.querySelector('[data-testid="p1"]');
    expect(panel).toBeTruthy();
    const span = panel?.querySelector(':scope > span');
    expect(span).toBeTruthy();
    expect(span?.querySelector('[data-testid="p1-content"]')).toBeTruthy();
  });

  it('Panel without draggable does not introduce a DragHandle span', () => {
    const store = new Store();
    const { container } = render(
      <Provider store={store}>
        <StrategyRegistryProvider strategies={{ grid: gridStrategy }}>
          <Zone
            id={asNodeId('z')}
            strategyId="grid"
            config={{ cols: 1 }}
            viewport={{ w: 200, h: 200 }}
          >
            <Panel id={asNodeId('p1')} data-testid="p1">
              <div data-testid="p1-content">hello</div>
            </Panel>
          </Zone>
        </StrategyRegistryProvider>
      </Provider>,
    );
    const panel = container.querySelector('[data-testid="p1"]');
    expect(panel?.querySelector(':scope > span')).toBeNull();
    expect(panel?.querySelector('[data-testid="p1-content"]')).toBeTruthy();
  });

  it('Zone with acceptsDrops renders without throwing when DragProvider is present', () => {
    const store = new Store();
    expect(() =>
      render(
        <Provider store={store}>
          <StrategyRegistryProvider strategies={{ grid: gridStrategy }}>
            <DragProvider>
              <Zone
                id={asNodeId('z')}
                strategyId="grid"
                config={{ cols: 1 }}
                viewport={{ w: 200, h: 200 }}
                acceptsDrops
              >
                <Panel id={asNodeId('p1')} data-testid="p1" />
              </Zone>
            </DragProvider>
          </StrategyRegistryProvider>
        </Provider>,
      ),
    ).not.toThrow();
  });

  it('Zone without acceptsDrops renders without a DragProvider in scope', () => {
    // Regression: PresetShell always calls useDropTarget unconditionally.
    // When acceptsDrops is not set, the hook must tolerate the absence of
    // <DragProvider> rather than throwing.
    const store = new Store();
    expect(() =>
      render(
        <Provider store={store}>
          <StrategyRegistryProvider strategies={{ grid: gridStrategy }}>
            <Zone
              id={asNodeId('z')}
              strategyId="grid"
              config={{ cols: 1 }}
              viewport={{ w: 200, h: 200 }}
            >
              <Panel id={asNodeId('p1')} data-testid="p1" />
            </Zone>
          </StrategyRegistryProvider>
        </Provider>,
      ),
    ).not.toThrow();
  });
});
