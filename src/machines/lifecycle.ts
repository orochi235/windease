import { Machine } from '../fsm.js';

/** Where a node is in its life: `mounted → visible ↔ hidden → destroyed`.
 *  `destroyed` is terminal. */
export type LifecycleState = 'mounted' | 'visible' | 'hidden' | 'destroyed';
/** Events driving {@link LifecycleState}. */
export type LifecycleEvent = 'show' | 'hide' | 'destroy';

/** Build the lifecycle machine every node carries, starting `mounted`. */
export function createLifecycleMachine(): Machine<LifecycleState, LifecycleEvent> {
  return new Machine<LifecycleState, LifecycleEvent>({
    initial: 'mounted',
    transitions: {
      mounted: { show: 'visible', destroy: 'destroyed' },
      visible: { hide: 'hidden', destroy: 'destroyed' },
      hidden: { show: 'visible', destroy: 'destroyed' },
      destroyed: {},
    },
  });
}
