export default { title: 'Recursive zones' };

import {
  asNodeId,
  createPanel,
  createZone,
  gridStrategy,
  stackStrategy,
  WindeaseStore,
} from '../../index.js';
import type { Story } from '@ladle/react';
import { useMemo } from 'react';
import {
  type ChromeMap,
  NodeContainer,
  StrategyRegistryProvider,
  WindeaseProvider,
} from '../index.js';
import './windease.css';
import { colorClassForId } from './Panel.js';

const STRATEGIES = {
  grid: gridStrategy as never,
  stack: stackStrategy as never,
};

interface Args {
  cols: number;
  trayChildren: number;
  showSecondTray: boolean;
}

/**
 * Headline demo: a zone hosting two recursive panels, each of which
 * hosts its own children via the `container` capability. Demonstrates
 * arbitrary-depth recursion using the same primitives.
 */
export const RecursiveZones: Story<Args> = ({ cols, trayChildren, showSecondTray }) => {
  const store = useMemo(() => {
    const s = new WindeaseStore();
    s.registerNode(
      createZone({
        id: asNodeId('z'),
        strategyId: 'grid',
        config: { cols, gap: 12, padding: 12 },
      }),
    );

    s.registerNode(
      createPanel({
        id: asNodeId('tray-1'),
        parentId: asNodeId('z'),
        meta: { title: 'Tray 1' },
        container: { strategyId: 'stack', config: { axis: 'vertical', gap: 6, padding: 8 } },
      }),
    );
    s.showNode(asNodeId('tray-1'));
    for (let i = 0; i < trayChildren; i++) {
      const id = asNodeId(`tray-1-child-${i + 1}`);
      s.registerNode(
        createPanel({ id, parentId: asNodeId('tray-1'), meta: { title: `Item ${i + 1}` } }),
      );
      s.showNode(id);
    }

    if (showSecondTray) {
      s.registerNode(
        createPanel({
          id: asNodeId('tray-2'),
          parentId: asNodeId('z'),
          meta: { title: 'Tray 2' },
          container: {
            strategyId: 'stack',
            config: { axis: 'vertical', gap: 6, padding: 8 },
          },
        }),
      );
      s.showNode(asNodeId('tray-2'));
      for (let i = 0; i < 2; i++) {
        const id = asNodeId(`tray-2-child-${i + 1}`);
        s.registerNode(
          createPanel({ id, parentId: asNodeId('tray-2'), meta: { title: `Note ${i + 1}` } }),
        );
        s.showNode(id);
      }
    } else {
      s.registerNode(
        createPanel({
          id: asNodeId('solo'),
          parentId: asNodeId('z'),
          meta: { title: 'Solo' },
        }),
      );
      s.showNode(asNodeId('solo'));
    }

    return s;
    // biome-ignore lint/correctness/useExhaustiveDependencies: rebuild store when controls change
  }, [cols, trayChildren, showSecondTray]);

  const chrome: ChromeMap = useMemo(
    () => ({
      zone: ({ node, children }) => (
        <div className="windease-zone" style={{ width: '100%', height: '100%' }} data-id={node.id}>
          {children}
        </div>
      ),
      group: ({ node, children }) => (
        <div className={`story-panel ${colorClassForId(node.id)}`}>
          <strong>{String(node.meta?.title ?? node.id)}</strong>
          {children}
        </div>
      ),
      panel: ({ node, children }) => {
        const isTray = node.container !== undefined;
        const cls = `story-panel ${colorClassForId(node.id)}`;
        if (isTray) {
          return (
            <div className={cls} style={{ display: 'flex', flexDirection: 'column' }}>
              <strong style={{ marginBottom: 4 }}>{String(node.meta?.title ?? node.id)}</strong>
              <NodeContainer
                parentId={node.id}
                chrome={chrome}
                style={{ flex: 1, minHeight: 0 }}
              />
            </div>
          );
        }
        return (
          <div className={cls}>
            <span>{String(node.meta?.title ?? node.id)}</span>
          </div>
        );
      },
    }),
    [],
  );

  return (
    <WindeaseProvider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <div style={{ width: 720, height: 480 }}>
          <NodeContainer
            parentId={asNodeId('z')}
            chrome={chrome}
            viewport={{ w: 720, h: 480 }}
            className="windease-zone"
          />
        </div>
      </StrategyRegistryProvider>
    </WindeaseProvider>
  );
};

RecursiveZones.args = {
  cols: 2,
  trayChildren: 3,
  showSecondTray: true,
};

RecursiveZones.argTypes = {
  cols: { control: { type: 'range', min: 1, max: 4, step: 1 } },
  trayChildren: { control: { type: 'range', min: 0, max: 6, step: 1 } },
  showSecondTray: { control: { type: 'boolean' } },
};
