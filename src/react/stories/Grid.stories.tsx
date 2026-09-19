export default { title: 'Grid' };

import type { Story } from '@ladle/react';
import { useMemo, useState } from 'react';
import type { LayoutItem, NodeId } from '../../index.js';
import { asNodeId, createNode, gridStrategy, gridTiling, Store } from '../../index.js';
import {
  type ChromeMap,
  Container,
  DragHandle,
  DragProvider,
  Provider,
  StrategyRegistryProvider,
  useNode,
} from '../index.js';
import './windease.css';
import './grid-cells.css';

const STRATEGIES = {
  grid: gridStrategy as never,
};

const ZONE_ID = asNodeId('grid');

interface Args {
  cols: number;
  gap: number;
  padding: number;
  panelCount: number;
}

export const Grid: Story<Args> = ({ cols, gap, padding, panelCount }) => {
  const store = useMemo(() => {
    const s = new Store();
    s.registerNode(
      createNode({
        kind: 'zone',
        container: { strategyId: 'grid', config: { cols, gap, padding } },
        id: ZONE_ID,
      }),
    );
    for (let i = 0; i < panelCount; i++) {
      const id = asNodeId(`panel-${i + 1}`);
      s.registerNode(
        createNode({
          kind: 'panel',
          focus: true,
          id,
          parentId: ZONE_ID,
          meta: { title: `Window ${id}` },
        }),
      );
      s.showNode(id);
    }
    return s;
  }, [cols, gap, padding, panelCount]);

  const chrome: ChromeMap = useMemo(
    () => ({
      panel: ({ node }) => (
        <div className="windease-panel">
          <header className="windease-panel__title">
            {String(node.meta?.title ?? `Window ${node.id}`)}
          </header>
        </div>
      ),
    }),
    [],
  );

  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <div style={{ width: 480, height: 360 }}>
          <Container
            parentId={ZONE_ID}
            chrome={chrome}
            viewport={{ w: 480, h: 360 }}
            className="windease-zone"
          />
        </div>
      </StrategyRegistryProvider>
    </Provider>
  );
};

Grid.args = {
  cols: 2,
  gap: 8,
  padding: 8,
  panelCount: 4,
};

Grid.argTypes = {
  cols: { control: { type: 'range', min: 1, max: 6, step: 1 } },
  gap: { control: { type: 'range', min: 0, max: 32, step: 1 } },
  padding: { control: { type: 'range', min: 0, max: 32, step: 1 } },
  panelCount: { control: { type: 'range', min: 1, max: 12, step: 1 } },
};

/** Auto-balanced tiling with draggable seams: drag a cell edge, or Tab to a
 *  seam and press an arrow. Extents move a whole cell at a time. */
export const ResizableGrid: Story = () => {
  const store = useMemo(() => {
    const s = new Store();
    const zone = asNodeId('grid-resizable');
    s.registerNode(
      createNode({
        kind: 'zone',
        container: {
          strategyId: 'grid',
          config: { resizable: true, gap: 8, padding: 8 },
        },
        id: zone,
      }),
    );
    for (let i = 0; i < 6; i++) {
      const id = asNodeId(`tile-${i + 1}`);
      s.registerNode(
        createNode({
          kind: 'panel',
          focus: true,
          id,
          parentId: zone,
          meta: { title: `Tile ${i + 1}` },
        }),
      );
      s.showNode(id);
    }
    return s;
  }, []);

  const chrome: ChromeMap = {
    panel: ({ node }) => (
      <div className="windease-panel">
        <header className="windease-panel__title">{String(node.meta?.title ?? node.id)}</header>
      </div>
    ),
  };

  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <div style={{ width: 560, height: 400 }}>
          <Container
            parentId={asNodeId('grid-resizable')}
            chrome={chrome}
            viewport={{ w: 560, h: 400 }}
            className="windease-zone"
            affordances
          />
        </div>
      </StrategyRegistryProvider>
    </Provider>
  );
};

/** The grid sizes itself: `gridTiling` reports the rows the config produces
 *  for this many tiles, and the zone is that many row-heights tall. Drag the
 *  count and the width — the zone grows and shrinks by whole rows, and the
 *  caption is the same tiling the cells were placed into. */
export const ContentSizedGrid: Story<{ tileCount: number; width: number }> = ({
  tileCount,
  width,
}) => {
  const GAP = 8;
  const PADDING = 8;
  const ROW_HEIGHT = 96;
  const zone = asNodeId('grid-content-sized');
  const config = useMemo(
    () => ({ maxCols: Math.max(1, Math.floor(width / 180)), gap: GAP, padding: PADDING }),
    [width],
  );

  const store = useMemo(() => {
    const s = new Store();
    s.registerNode(
      createNode({ kind: 'zone', container: { strategyId: 'grid', config }, id: zone }),
    );
    for (let i = 0; i < tileCount; i++) {
      const id = asNodeId(`card-${i + 1}`);
      s.registerNode(
        createNode({
          kind: 'panel',
          focus: true,
          id,
          parentId: zone,
          meta: { title: `Card ${i + 1}` },
        }),
      );
      s.showNode(id);
    }
    return s;
  }, [config, tileCount, zone]);

  // The whole point: no layout pass, no probe height, no measuring back.
  const items: LayoutItem[] = useMemo(
    () => Array.from({ length: tileCount }, (_, i) => ({ id: `card-${i + 1}` })),
    [tileCount],
  );
  const { cols, rows } = gridTiling(items, config);
  const height = rows === 0 ? 0 : rows * ROW_HEIGHT + GAP * (rows - 1) + PADDING * 2;

  const chrome: ChromeMap = {
    panel: ({ node }) => (
      <div className="windease-panel">
        <header className="windease-panel__title">{String(node.meta?.title ?? node.id)}</header>
      </div>
    ),
  };

  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <p data-testid="tiling">
          {cols} x {rows} — zone {height}px tall
        </p>
        <div data-testid="content-sized-zone" style={{ width, height }}>
          <Container
            parentId={zone}
            chrome={chrome}
            viewport={{ w: width, h: height }}
            className="windease-zone"
          />
        </div>
      </StrategyRegistryProvider>
    </Provider>
  );
};

ContentSizedGrid.args = {
  tileCount: 5,
  width: 560,
};

ContentSizedGrid.argTypes = {
  tileCount: { control: { type: 'range', min: 0, max: 16, step: 1 } },
  width: { control: { type: 'range', min: 200, max: 900, step: 20 } },
};

/** Periods 1–3: [symbol, group column, period row], zero-based. */
const ELEMENTS: readonly [string, number, number][] = [
  ['H', 0, 0],
  ['He', 17, 0],
  ['Li', 0, 1],
  ['Be', 1, 1],
  ['B', 12, 1],
  ['C', 13, 1],
  ['N', 14, 1],
  ['O', 15, 1],
  ['F', 16, 1],
  ['Ne', 17, 1],
  ['Na', 0, 2],
  ['Mg', 1, 2],
  ['Al', 12, 2],
  ['Si', 13, 2],
  ['P', 14, 2],
  ['S', 15, 2],
  ['Cl', 16, 2],
  ['Ar', 17, 2],
];

const TABLE = asNodeId('periodic-table');

function periodicStore(): Store {
  const s = new Store();
  s.registerNode(
    createNode({
      kind: 'zone',
      container: { strategyId: 'grid', config: { cols: 18, gap: 4, padding: 8 } },
      id: TABLE,
    }),
  );
  ELEMENTS.forEach(([symbol, col, row], i) => {
    const id = asNodeId(symbol.toLowerCase());
    s.registerNode(
      createNode({
        kind: 'panel',
        focus: true,
        id,
        parentId: TABLE,
        meta: { title: symbol, number: i + 1 },
      }),
    );
    s.patchPlacement(id, { cell: { col, row } });
    s.showNode(id);
  });
  return s;
}

const elementChrome: ChromeMap = {
  panel: ({ node }) => (
    <DragHandle nodeId={node.id} className="gc-element">
      <span className="gc-element__number">{String(node.meta?.number ?? '')}</span>
      <span className="gc-element__symbol">{String(node.meta?.title ?? node.id)}</span>
    </DragHandle>
  ),
};

/** Every element holds `placement.cell` at its group and period, so the gaps
 *  in periods 1–3 stay open. Move one with the form: a cell someone already
 *  holds, or past column 17, sends it to the unplaced list. Drag one, and the
 *  move clears its cell, so it drops into the first free cell of the flow. */
export const PeriodicTable: Story = () => {
  const [generation, setGeneration] = useState(0);
  const store = useMemo(() => {
    void generation;
    return periodicStore();
  }, [generation]);
  const [target, setTarget] = useState('ne');
  const [col, setCol] = useState(17);
  const [row, setRow] = useState(0);

  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <DragProvider>
          <form
            className="gc-controls"
            onSubmit={(e) => {
              e.preventDefault();
              store.patchPlacement(target as NodeId, { cell: { col, row } });
            }}
          >
            <label>
              Element{' '}
              <select
                data-testid="cell-target"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                {ELEMENTS.map(([symbol]) => (
                  <option key={symbol} value={symbol.toLowerCase()}>
                    {symbol}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Column{' '}
              <input
                data-testid="cell-col"
                type="number"
                min={0}
                value={col}
                onChange={(e) => setCol(Number(e.target.value))}
              />
            </label>
            <label>
              Row{' '}
              <input
                data-testid="cell-row"
                type="number"
                min={0}
                value={row}
                onChange={(e) => setRow(Number(e.target.value))}
              />
            </label>
            <button type="submit">Place</button>
            <button type="button" onClick={() => setGeneration((g) => g + 1)}>
              Reset
            </button>
          </form>
          <div className="gc-table">
            <Container
              parentId={TABLE}
              chrome={elementChrome}
              viewport={{ w: 760, h: 150 }}
              className="windease-zone"
              overlay={({ unplaced }) => (
                <p className="gc-unplaced" data-testid="unplaced">
                  Unplaced: {unplaced.length > 0 ? unplaced.join(', ') : 'none'}
                </p>
              )}
            />
          </div>
        </DragProvider>
      </StrategyRegistryProvider>
    </Provider>
  );
};

const LIBRARY = asNodeId('app-library');
const DOCK = asNodeId('dock');
const ICON = { w: 56, h: 56 };
const APPS = [
  'Mail',
  'Maps',
  'Music',
  'Notes',
  'Photos',
  'Clock',
  'News',
  'Books',
  'Files',
  'Home',
];
const DOCKED = ['Phone', 'Safari', 'Messages', 'Camera'];

type Justify = 'start' | 'center' | 'end' | 'between' | 'evenly';

function dockStore(justify: Justify): Store {
  const s = new Store();
  s.registerNode(
    createNode({
      kind: 'zone',
      container: { strategyId: 'grid', config: { cell: ICON, gap: 12, padding: 12 } },
      id: LIBRARY,
    }),
  );
  s.registerNode(
    createNode({
      kind: 'zone',
      container: {
        strategyId: 'grid',
        config: { cell: ICON, gap: 12, padding: 12, maxItems: 5, justify },
      },
      id: DOCK,
    }),
  );
  for (const [names, parentId] of [
    [APPS, LIBRARY],
    [DOCKED, DOCK],
  ] as const) {
    for (const name of names) {
      const id = asNodeId(name.toLowerCase());
      s.registerNode(
        createNode({ kind: 'panel', focus: true, id, parentId, meta: { title: name } }),
      );
      s.showNode(id);
    }
  }
  return s;
}

const iconChrome: ChromeMap = {
  panel: ({ node }) => (
    <DragHandle nodeId={node.id} className="gc-icon">
      {String(node.meta?.title ?? node.id)}
    </DragHandle>
  ),
};

/** Both grids set `cell: { w: 56, h: 56 }`, so an icon stays 56px square
 *  however wide its grid is, and the columns are however many icons fit
 *  across. The dock's `justify` spaces its icons across the leftover width —
 *  `'evenly'`, as iOS does. Drag icons between the library and the dock; the
 *  dock's `maxItems: 5` refuses a sixth. */
export const Dock: Story<{ justify: Justify }> = ({ justify }) => {
  const store = useMemo(() => dockStore(justify), [justify]);
  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <DragProvider>
          <div className="gc-springboard">
            <Container
              parentId={LIBRARY}
              chrome={iconChrome}
              viewport={{ w: 480, h: 220 }}
              className="windease-zone"
            />
            <Container
              parentId={DOCK}
              chrome={iconChrome}
              viewport={{ w: 480, h: 80 }}
              className="windease-zone gc-dock"
            />
          </div>
        </DragProvider>
      </StrategyRegistryProvider>
    </Provider>
  );
};

Dock.args = { justify: 'evenly' };

Dock.argTypes = {
  justify: { options: ['start', 'center', 'end', 'between', 'evenly'], control: { type: 'radio' } },
};

const SHEET = asNodeId('sheet');
const SHEET_COLS = ['', 'A', 'B', 'C', 'D', 'E'];
const SHEET_ROWS = 8;
/** The row-number column and A–B hold pixels; C and D split what is left, so
 *  the seam between them trades width; E holds pixels. */
const SHEET_TRACKS = {
  cols: [40, 96, 96, { share: 1 }, { share: 1 }, 72],
  rows: [28],
};

function sheetStore(): Store {
  const s = new Store();
  s.registerNode(
    createNode({
      kind: 'zone',
      container: {
        strategyId: 'grid',
        config: { gap: 1, resizable: true, cell: { h: 26 }, tracks: SHEET_TRACKS },
      },
      id: SHEET,
    }),
  );
  for (let row = 0; row <= SHEET_ROWS; row++) {
    SHEET_COLS.forEach((letter, col) => {
      const header = row === 0 || col === 0;
      const title = row === 0 ? letter : col === 0 ? String(row) : `${letter}${row}`;
      const id = asNodeId(row === 0 && col === 0 ? 'corner' : `cell-${title}`);
      s.registerNode(
        createNode({ kind: 'panel', focus: true, id, parentId: SHEET, meta: { title, header } }),
      );
      s.showNode(id);
    });
  }
  return s;
}

const sheetChrome: ChromeMap = {
  panel: ({ node }) => (
    <div className={node.meta?.header ? 'gc-sheet-cell gc-sheet-cell--header' : 'gc-sheet-cell'}>
      {String(node.meta?.title ?? '')}
    </div>
  ),
};

function TracksReadout({ id }: { id: NodeId }) {
  const tracks = (useNode(id)?.container?.config as { tracks?: unknown } | undefined)?.tracks;
  return (
    <p className="gc-readout">
      tracks: <code data-testid="tracks">{JSON.stringify(tracks)}</code>
    </p>
  );
}

/** A spreadsheet from `tracks`: pixel columns keep their width, the two share
 *  columns split the rest, and the header row is taller than the 26px rows
 *  `cell.h` gives the others. Drag the line after a column letter or a row
 *  number, or Tab to it and press an arrow. The drag writes the new sizes back
 *  into the grid's config, shown below the sheet. */
export const Spreadsheet: Story = () => {
  const store = useMemo(sheetStore, []);
  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <div className="gc-sheet">
          <Container
            parentId={SHEET}
            chrome={sheetChrome}
            viewport={{ w: 640, h: 280 }}
            className="windease-zone gc-sheet__grid"
            affordances
          />
        </div>
        <TracksReadout id={SHEET} />
      </StrategyRegistryProvider>
    </Provider>
  );
};
