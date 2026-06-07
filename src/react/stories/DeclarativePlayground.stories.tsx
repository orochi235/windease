import type { Story } from '@ladle/react';
import { useEffect, useMemo, useState } from 'react';
import {
  asNodeId,
  createPanel,
  gridStrategy,
  Store,
} from '../../index.js';
import {
  Panel,
  Provider,
  StrategyRegistryProvider,
  Zone,
} from '../index.js';
import './windease.css';
import './playground.css';

export default { title: 'Declarative / Mixed Provenance' };

export const MixedProvenance: Story = () => {
  const store = useMemo(() => new Store(), []);
  const [impCount, setImpCount] = useState(2);

  // Imperatively pre-register two children of "root" once the JSX zone
  // has registered itself. We can't pre-register before the zone exists,
  // so we do it in an effect that fires AFTER the first JSX render.
  useEffect(() => {
    if (store.getNode(asNodeId('root')) && !store.getNode(asNodeId('imp-1'))) {
      store.registerNode(
        createPanel({
          id: asNodeId('imp-1'),
          parentId: asNodeId('root'),
          meta: { title: 'imp-1' },
        }),
      );
    }
    if (store.getNode(asNodeId('root')) && !store.getNode(asNodeId('imp-2'))) {
      store.registerNode(
        createPanel({
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
        <Zone
          id={asNodeId('root')}
          strategyId="grid"
          config={{ cols: 3 }}
          viewport={{ w: 900, h: 540 }}
        >
          <Panel id={asNodeId('jsx-a')} meta={{ title: 'jsx-a' }} />
          <Panel id={asNodeId('jsx-b')} meta={{ title: 'jsx-b' }} order={10} />
          <Panel id={asNodeId('jsx-c')} meta={{ title: 'jsx-c' }} />
        </Zone>
        <ImperativeControls
          onAdd={() => {
            const next = impCount + 1;
            setImpCount(next);
            const id = asNodeId(`imp-${next}`);
            store.registerNode(
              createPanel({
                id,
                parentId: asNodeId('root'),
                meta: { title: `imp-${next}` },
              }),
            );
            store.showNode(id);
          }}
          onRemove={() => {
            const view = store.getContainerView(asNodeId('root'));
            const last = view?.childIds
              .slice()
              .reverse()
              .find((id) => String(id).startsWith('imp-'));
            if (last) store.unregisterNode(last);
          }}
          onAttemptCollision={() => {
            try {
              store.registerNode(
                createPanel({
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
            alert(
              'Set meta on jsx-b. Next render of <Panel> will overwrite it back to "jsx-b".',
            );
          }}
          onMutateImperative={() => {
            store.setMeta(asNodeId('imp-1'), { title: 'mutated-imp-1' });
          }}
        />
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
      <button type="button" onClick={props.onAdd}>+ imperative panel</button>
      <button type="button" onClick={props.onRemove}>− last imperative</button>
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
