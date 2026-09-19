export default { title: 'Reorder' };

import type { Story } from '@ladle/react';
import { useMemo, useState } from 'react';
import { asNodeId, createNode, type NodeId, Store, stripStrategy } from '../../index.js';
import {
  type ChromeMap,
  Container,
  DragProvider,
  Panel,
  Provider,
  StrategyRegistryProvider,
  Zone,
} from '../index.js';
import '../styles.css';
import './reorder.css';

const STRATEGIES = { strip: stripStrategy as never };

const TOP = asNodeId('top-strip');
const BOTTOM = asNodeId('bottom-strip');
const STRIP = { axis: 'x', fill: true, reorder: true } as const;

function makeStore(): Store {
  const s = new Store();
  for (const id of [TOP, BOTTOM]) {
    s.registerNode(
      createNode({ kind: 'zone', id, container: { strategyId: 'strip', config: STRIP } }),
    );
  }
  const seed: Array<[string, NodeId, string]> = [
    ['news', TOP, 'News'],
    ['mail', TOP, 'Mail'],
    ['docs', TOP, 'Docs'],
    ['maps', TOP, 'Maps'],
    ['music', BOTTOM, 'Music'],
    ['notes', BOTTOM, 'Notes'],
  ];
  for (const [id, parentId, title] of seed) {
    const nid = asNodeId(id);
    s.registerNode(createNode({ kind: 'tab', id: nid, parentId, meta: { title } }));
    s.showNode(nid);
  }
  return s;
}

/**
 * Two browser windows, each a strip of tabs whose container declares
 * `reorder: true`. The tab chrome is a plain element with a click handler: no
 * `DragHandle`. Drag a tab along its strip to reorder it, or into the other
 * window's strip to move it there; a click selects.
 */
export const FirefoxTabs: Story = () => {
  const store = useMemo(() => makeStore(), []);
  const [selected, setSelected] = useState<string>('news');

  const chrome: ChromeMap = useMemo(
    () => ({
      tab: ({ node }) => (
        // biome-ignore lint/a11y/useKeyWithClickEvents: the tab is a story's pointer demo; keyboard selection is out of scope.
        // biome-ignore lint/a11y/noStaticElementInteractions: as above.
        <div
          className="ro-tab"
          data-testid={`tab-${node.id}`}
          data-selected={selected === node.id ? 'true' : undefined}
          onClick={() => setSelected(node.id)}
        >
          <span className="ro-tab__icon" aria-hidden="true" />
          <span className="ro-tab__label">{String(node.meta?.title ?? node.id)}</span>
        </div>
      ),
    }),
    [selected],
  );

  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <DragProvider>
          <div className="ro-windows">
            {[TOP, BOTTOM].map((id) => (
              <section key={id} className="ro-window" aria-label={id}>
                <div className="ro-strip">
                  <Container parentId={id} chrome={chrome} className="ro-strip__inner" />
                </div>
                <div className="ro-page">Page</div>
              </section>
            ))}
          </div>
          <p className="ro-hint">
            Selected: <output data-testid="selected">{selected}</output>. Drag a tab along its
            strip, or into the other window.
          </p>
        </DragProvider>
      </StrategyRegistryProvider>
    </Provider>
  );
};

const ROWS = [
  { id: 'inbox', title: 'Inbox' },
  { id: 'drafts', title: 'Drafts' },
  { id: 'sent', title: 'Sent' },
  { id: 'archive', title: 'Archive' },
];

/**
 * A list built from presets whose zone declares `reorder: 'handle'`: only the
 * grip, marked `data-windease-handle`, starts a drag. A press on the row's
 * label selects it and never moves it.
 */
export const Handle: Story = () => {
  const store = useMemo(() => new Store(), []);
  const [selected, setSelected] = useState<string>('inbox');
  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <DragProvider>
          <Zone
            id={asNodeId('folders')}
            strategyId="strip"
            config={{ axis: 'y', fill: true, gap: 4, reorder: 'handle' }}
            viewport={{ w: 320, h: 200 }}
            className="ro-list"
            acceptsDrops
          >
            {ROWS.map((row) => (
              <Panel key={row.id} id={asNodeId(row.id)} className="ro-row">
                <span className="ro-row__grip" data-windease-handle data-testid={`grip-${row.id}`}>
                  ⋮⋮
                </span>
                <button
                  type="button"
                  className="ro-row__label"
                  data-testid={`row-${row.id}`}
                  data-selected={selected === row.id ? 'true' : undefined}
                  onClick={() => setSelected(row.id)}
                >
                  {row.title}
                </button>
              </Panel>
            ))}
          </Zone>
          <p className="ro-hint">
            Selected: <output data-testid="selected">{selected}</output>. Drag a row by its grip.
          </p>
        </DragProvider>
      </StrategyRegistryProvider>
    </Provider>
  );
};
