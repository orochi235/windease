import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Gesture, type GestureOptions, type GestureState } from '../gesture.js';

/**
 * One {@link Gesture} for the life of the component, run by the options of the
 * latest render, and its state as React state. Unmounting mid-gesture cancels
 * it, so an armed target is disarmed rather than left marked.
 */
export function useGesture<T>(options: GestureOptions<T>): [Gesture<T>, GestureState<T>] {
  const latest = useRef(options);
  latest.current = options;
  const [gesture] = useState(
    () =>
      new Gesture<T>({
        get name() {
          return latest.current.name;
        },
        refuse: () => latest.current.refuse?.() ?? null,
        permits: (target) => latest.current.permits?.(target) ?? true,
        commit: (target) => latest.current.commit(target),
        undo: {
          transact: (fn, label) => {
            const undo = latest.current.undo;
            if (undo) undo.transact(fn, label);
            else fn();
          },
          label: (target) => latest.current.undo?.label(target),
        },
        describe: (target) => latest.current.describe?.(target) ?? '',
        same: (a, b) => (latest.current.same ?? Object.is)(a, b),
        show: (target) => latest.current.show?.(target) ?? String(target),
        onArm: (target) => latest.current.onArm?.(target),
        onEnd: (how) => latest.current.onEnd?.(how),
      }),
  );
  const subscribe = useCallback((fn: () => void) => gesture.subscribe(fn), [gesture]);
  const read = useCallback(() => gesture.state(), [gesture]);
  const state = useSyncExternalStore(subscribe, read, read);
  useEffect(() => () => gesture.cancel('unmount'), [gesture]);
  return [gesture, state];
}
