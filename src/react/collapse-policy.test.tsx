import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  asNodeId,
  type CollapsePolicy,
  collapse,
  createNode,
  type DragController,
  Store,
  stripStrategy,
} from '../index.js';
import { DragProvider, useDragController } from './dnd/DragProvider.js';
import { Provider } from './Provider.js';
import { Zone } from './presets.js';
import { StrategyRegistryProvider } from './strategies.js';

afterEach(cleanup);

const ROOT = asNodeId('root');
const SIDE = asNodeId('side');
const MAIN = asNodeId('main');
const TOOL = asNodeId('tool');
const DOC = asNodeId('doc');
const GROUP = { axis: 'y', fill: true };

function Capture({ into }: { into: { controller?: DragController } }) {
  into.controller = useDragController();
  return null;
}

/** root ▸ [side ▸ [tool], main ▸ [doc]], with `side` 240 wide. */
async function mount(policy: CollapsePolicy) {
  const store = new Store({ collapsePolicy: policy });
  const captured: { controller?: DragController } = {};
  const view = render(
    <Provider store={store}>
      <StrategyRegistryProvider strategies={{ strip: stripStrategy as never }}>
        <DragProvider dragOverlay={null}>
          <Capture into={captured} />
          <Zone
            id={ROOT}
            strategyId="strip"
            config={{ axis: 'x', fill: true }}
            viewport={{ w: 1000, h: 600 }}
          >
            <Zone id={SIDE} kind="group" strategyId="strip" config={GROUP} acceptsDrops />
            <Zone id={MAIN} kind="group" strategyId="strip" config={GROUP} acceptsDrops />
          </Zone>
        </DragProvider>
      </StrategyRegistryProvider>
    </Provider>,
  );
  await act(async () => {
    store.registerNode(createNode({ kind: 'panel', focus: true, id: TOOL, parentId: SIDE }));
    store.registerNode(createNode({ kind: 'panel', focus: true, id: DOC, parentId: MAIN }));
    store.showNode(TOOL);
    store.showNode(DOC);
    store.patchPlacement(SIDE, { size: { w: 240 } });
  });
  // A preset's shell fills the box its parent's layout placed it in.
  const boxOf = (id: string) =>
    view.container.querySelector(`[data-node="${id}"]`)?.parentElement?.style;
  const widthOf = (id: string) => boxOf(id)?.width;
  return { store, widthOf, boxOf, controller: captured.controller as DragController };
}

describe('collapsePolicy through the presets', () => {
  it('shuts a group when its last pane leaves and reopens it on return', async () => {
    const { store, widthOf } = await mount(collapse());
    expect([widthOf('side'), widthOf('main')]).toEqual(['240px', '760px']);

    await act(async () => store.moveNode(TOOL, MAIN));
    expect([widthOf('side'), widthOf('main')]).toEqual(['0px', '1000px']);

    await act(async () => store.moveNode(TOOL, SIDE));
    expect([widthOf('side'), widthOf('main')]).toEqual(['240px', '760px']);
  });

  it('clips a shut group to its box, so its chrome cannot show past it', async () => {
    const { store, boxOf } = await mount(collapse());
    expect(boxOf('side')?.overflow).toBe('');
    await act(async () => store.moveNode(TOOL, MAIN));
    expect(boxOf('side')?.overflow).toBe('hidden');
  });

  it('opens a shut group for the length of a drag it would take', async () => {
    const { store, widthOf, controller } = await mount(collapse({ dragTo: 200 }));
    await act(async () => store.moveNode(TOOL, MAIN));
    expect(widthOf('side')).toBe('0px');

    await act(async () => {
      controller.tryBegin(TOOL);
    });
    expect([widthOf('side'), widthOf('main')]).toEqual(['200px', '800px']);

    await act(async () => controller.cancel());
    expect([widthOf('side'), widthOf('main')]).toEqual(['0px', '1000px']);
  });
});
