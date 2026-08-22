import type { Story } from '@ladle/react';
import { useEffect, useMemo, useState } from 'react';
import { asNodeId, createNode, gridStrategy, Store, stripStrategy } from '../../index.js';
import {
  DragProvider,
  defaultDragOverlay,
  FocusProvider,
  GeometryProvider,
  Panel,
  Provider,
  preserveStoreOrder,
  StrategyRegistryProvider,
  Zone,
} from '../index.js';
import './windease.css';
import './playground.css';
import './declarative-keyboard.css';

export default { title: 'Declarative' };

export const MixedProvenance: Story = () => {
  const store = useMemo(() => new Store(), []);
  const [impCount, setImpCount] = useState(2);

  // Imperatively pre-register two children of "root" once the JSX zone
  // has registered itself. We can't pre-register before the zone exists,
  // so we do it in an effect that fires AFTER the first JSX render.
  useEffect(() => {
    if (store.getNode(asNodeId('root')) && !store.getNode(asNodeId('imp-1'))) {
      store.registerNode(
        createNode({
          kind: 'panel',
          focus: true,
          id: asNodeId('imp-1'),
          parentId: asNodeId('root'),
          meta: { title: 'imp-1' },
        }),
      );
    }
    if (store.getNode(asNodeId('root')) && !store.getNode(asNodeId('imp-2'))) {
      store.registerNode(
        createNode({
          kind: 'panel',
          focus: true,
          id: asNodeId('imp-2'),
          parentId: asNodeId('root'),
          meta: { title: 'imp-2' },
          order: 15,
        }),
      );
    }
    store.showNode(asNodeId('imp-1'));
    store.showNode(asNodeId('imp-2'));
  }, [store]);

  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={{ grid: gridStrategy }}>
        <DragProvider dragOverlay={defaultDragOverlay}>
          <Zone
            id={asNodeId('root')}
            strategyId="grid"
            config={{ cols: 3 }}
            viewport={{ w: 900, h: 540 }}
            acceptsDrops
            renderImperative={(node) => (
              <div className="windease-panel" style={{ background: '#fef3c7', height: '100%' }}>
                <header className="windease-panel__title">
                  {String(node.meta?.title ?? node.id)} (imperative)
                </header>
              </div>
            )}
          >
            <Panel id={asNodeId('jsx-a')} meta={{ title: 'jsx-a' }} draggable />
            <Panel id={asNodeId('jsx-b')} meta={{ title: 'jsx-b' }} order={10} draggable />
            <Panel id={asNodeId('jsx-c')} meta={{ title: 'jsx-c' }} draggable />
          </Zone>
          <ImperativeControls
            onAdd={() => {
              const next = impCount + 1;
              setImpCount(next);
              const id = asNodeId(`imp-${next}`);
              store.registerNode(
                createNode({
                  kind: 'panel',
                  focus: true,
                  id,
                  parentId: asNodeId('root'),
                  meta: { title: `imp-${next}` },
                }),
              );
              store.showNode(id);
            }}
            onRemove={() => {
              const view = store.getContainerView(asNodeId('root'));
              const last = view?.childOrder
                .slice()
                .reverse()
                .find((id) => String(id).startsWith('imp-'));
              if (last) store.unregisterNode(last);
            }}
            onAttemptCollision={() => {
              try {
                store.registerNode(
                  createNode({
                    kind: 'panel',
                    focus: true,
                    id: asNodeId('jsx-a'),
                    parentId: asNodeId('root'),
                  }),
                );
                alert('UNEXPECTED: collision did not throw');
              } catch (err) {
                alert(`Collision correctly rejected: ${(err as Error).message}`);
              }
            }}
            onMutateJsxOwned={() => {
              store.setMeta(asNodeId('jsx-b'), { title: 'mutated-from-outside' });
              alert('Set meta on jsx-b. Next render of <Panel> will overwrite it back to "jsx-b".');
            }}
            onMutateImperative={() => {
              store.setMeta(asNodeId('imp-1'), { title: 'mutated-imp-1' });
            }}
          />
        </DragProvider>
      </StrategyRegistryProvider>
    </Provider>
  );
};

function ImperativeControls(props: {
  onAdd: () => void;
  onRemove: () => void;
  onAttemptCollision: () => void;
  onMutateJsxOwned: () => void;
  onMutateImperative: () => void;
}) {
  return (
    <div
      style={{
        marginTop: 16,
        display: 'flex',
        flexWrap: 'wrap',
        gap: 8,
        font: '12px/1.4 system-ui, sans-serif',
      }}
    >
      <button type="button" onClick={props.onAdd}>
        + imperative panel
      </button>
      <button type="button" onClick={props.onRemove}>
        − last imperative
      </button>
      <button type="button" onClick={props.onAttemptCollision}>
        collide with jsx-a (should throw)
      </button>
      <button type="button" onClick={props.onMutateJsxOwned}>
        setMeta(jsx-b) (should revert)
      </button>
      <button type="button" onClick={props.onMutateImperative}>
        setMeta(imp-1) (should stick)
      </button>
    </div>
  );
}

/**
 * A tree built only from presets — no `<Container>` anywhere. The panes are
 * reachable by keyboard because `Zone` and `Panel` report their children's
 * rects to the `GeometryProvider`, which is what directional navigation
 * scores. The left column is a nested `<Zone>`, the right a `<Panel>`
 * promoted to a container, so both layout-hosting presets are exercised.
 */
export const KeyboardNav: Story = () => {
  const store = useMemo(() => new Store(), []);

  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={{ stack: stripStrategy as never }}>
        <GeometryProvider>
          <FocusProvider>
            <Zone
              id={asNodeId('kb-root')}
              strategyId="stack"
              config={{ axis: 'x', fill: true, gap: 16, padding: 16 }}
              viewport={{ w: 720, h: 400 }}
              className="kb-frame"
            >
              <Zone
                id={asNodeId('kb-left')}
                strategyId="stack"
                config={{ axis: 'y', fill: true, gap: 8, padding: 8 }}
                sort={preserveStoreOrder}
                className="kb-col"
              >
                <Panel id={asNodeId('kb-a')} className="kb-pane" title="Alpha" />
                <Panel id={asNodeId('kb-b')} className="kb-pane" title="Bravo" />
                <Panel id={asNodeId('kb-c')} className="kb-pane" title="Charlie" />
              </Zone>
              <Panel
                id={asNodeId('kb-right')}
                className="kb-col"
                container={{
                  strategyId: 'stack',
                  config: { axis: 'y', fill: true, gap: 8, padding: 8 },
                }}
              >
                <Panel id={asNodeId('kb-d')} className="kb-pane" title="Delta" />
                <Panel id={asNodeId('kb-e')} className="kb-pane" title="Echo" />
              </Panel>
            </Zone>
            <p className="kb-hint">
              Click a pane, then use <kbd>↑</kbd> <kbd>↓</kbd> <kbd>←</kbd> <kbd>→</kbd> to move the
              caret — the sideways ones cross between the two columns. <kbd>Shift</kbd> plus an
              arrow moves the pane itself; the left column keeps whatever order you leave it in.
            </p>
          </FocusProvider>
        </GeometryProvider>
      </StrategyRegistryProvider>
    </Provider>
  );
};
