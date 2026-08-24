export default { title: 'Content sizing' };

import type { Story } from '@ladle/react';
import { useMemo, useState } from 'react';
import { asNodeId, createNode, Store, stripStrategy } from '../../index.js';
import { type ChromeMap, Container, Provider, StrategyRegistryProvider } from '../index.js';
import '../styles.css';
import './content-sizing.css';

const STRATEGIES = { strip: stripStrategy as never };
const DOCK = asNodeId('dock');
const ROWS: Record<string, number> = { 'palette-1': 2, 'palette-2': 3, 'palette-3': 1 };

function makeDock(): Store {
  const s = new Store();
  s.registerNode(
    createNode({
      kind: 'zone',
      container: { strategyId: 'strip', config: { axis: 'y', gap: 6, padding: 6 } },
      id: DOCK,
    }),
  );
  for (const [id, _] of Object.entries(ROWS)) {
    const nid = asNodeId(id);
    s.registerNode(
      createNode({
        kind: 'palette',
        focus: true,
        id: nid,
        parentId: DOCK,
        hints: { sizing: { h: 'content' }, minSize: { w: 0, h: 40 } },
        meta: { title: id.replace('palette-', 'Palette ') },
      }),
    );
    s.showNode(nid);
  }
  return s;
}

/** Rows are the content: adding one must grow the pane with no size written. */
function Rows({ id, extra }: { id: string; extra: number }) {
  const count = (ROWS[id] ?? 1) + (id === 'palette-1' ? extra : 0);
  return (
    <div data-rows={id}>
      {Array.from({ length: count }, (_, i) => `${id}-row-${i + 1}`).map((key, i) => (
        <div className="cs-row" key={key}>
          row {i + 1}
        </div>
      ))}
    </div>
  );
}

export const ContentSizedDock: Story = () => {
  const store = useMemo(() => makeDock(), []);
  const [extra, setExtra] = useState(0);
  const chrome: ChromeMap = {
    palette: ({ node }) => (
      <div className="cs-palette">
        <header className="cs-palette__title">{String(node.meta?.title ?? node.id)}</header>
        <Rows id={String(node.id)} extra={extra} />
      </div>
    ),
  };
  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <button type="button" data-testid="add-row" onClick={() => setExtra((n) => n + 1)}>
          add a row to Palette 1
        </button>
        <button
          type="button"
          data-testid="release-size"
          onClick={() => store.patchPlacement(asNodeId('palette-1'), { size: { h: undefined } })}
        >
          release Palette 1 back to its contents
        </button>
        <div style={{ width: 260, height: 420 }}>
          <Container
            parentId={DOCK}
            chrome={chrome}
            viewport={{ w: 260, h: 420 }}
            affordances
            className="windease-zone"
          />
        </div>
      </StrategyRegistryProvider>
    </Provider>
  );
};
