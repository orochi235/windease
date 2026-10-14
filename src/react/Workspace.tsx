import {
  type CSSProperties,
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  arrangeWorkspace,
  dispatchWorkspaceSeam,
  elementScale,
  type LayoutEvent,
  type NodeId,
  type Rect,
  type Store,
  toLocalPoint,
  type WorkspaceInput,
  type WorkspaceLayout,
  type WorkspaceSeam,
} from '../index.js';
import { AffordanceLayer, type AffordanceRenderer } from './affordances.js';
import { useNode } from './hooks.js';
import { useStore } from './Provider.js';
import { ResizeGestureContext } from './resize-gesture.js';

type Register = (id: NodeId, el: HTMLElement | null) => void;

const RegisterContext = createContext<Register | null>(null);
const LayoutContext = createContext<{ layout: WorkspaceLayout; armedId: NodeId | null } | null>(
  null,
);

const NO_SEAMS: readonly WorkspaceSeam[] = [];

/** Props for {@link Workspace}. */
export interface WorkspaceProps {
  /** The seams between roots. Each names two `<WorkspaceRoot>`s below. */
  seams?: readonly WorkspaceSeam[];
  /** A root that fills the workspace while the others are kept out of view,
   *  still mounted. Leave it out to zoom the root whose `hints.zoom` is set,
   *  which a snapshot carries; `null` zooms none. */
  zoom?: NodeId | null;
  /** `false` draws no seams; a function replaces the built-in handle, as on
   *  `<Container>`. Default `true`. */
  affordances?: boolean | AffordanceRenderer;
  /** Pixels the pointer-hit area reaches past a seam's drawn rect. Default 4. */
  affordanceHitPad?: number;
  /** Pixels one arrow-key press moves a focused seam. Default 8. */
  affordanceKeyStep?: number;
  /** Main-axis thickness of a seam. Default 4. */
  seamSize?: number;
  /** Pixels past a floor before a seam with `overshoot: 'hide'` arms. Default 24. */
  joinThreshold?: number;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

/** Each root's box relative to the workspace's padding box, in its own pixels. */
function measure(
  wrapper: HTMLElement,
  els: ReadonlyMap<NodeId, HTMLElement>,
): ReadonlyMap<NodeId, Rect> {
  const scale = elementScale(wrapper);
  const frame = wrapper.getBoundingClientRect();
  const origin = { x: frame.left, y: frame.top };
  const out = new Map<NodeId, Rect>();
  for (const [id, el] of els) {
    const r = el.getBoundingClientRect();
    // A root out of view has no box; a seam must not be drawn against one.
    if (r.width === 0 && r.height === 0) continue;
    const at = toLocalPoint({ x: r.left, y: r.top }, origin, scale);
    out.set(id, {
      x: at.x - wrapper.clientLeft + wrapper.scrollLeft,
      y: at.y - wrapper.clientTop + wrapper.scrollTop,
      z: 0,
      w: r.width / scale.x,
      h: r.height / scale.y,
    });
  }
  return out;
}

function sameRects(a: ReadonlyMap<NodeId, Rect>, b: ReadonlyMap<NodeId, Rect>): boolean {
  if (a.size !== b.size) return false;
  for (const [id, r] of a) {
    const o = b.get(id);
    if (!o || o.x !== r.x || o.y !== r.y || o.w !== r.w || o.h !== r.h) return false;
  }
  return true;
}

/** Everything `arrangeWorkspace` reads off the store for `ids`, as a string a
 *  `useSyncExternalStore` snapshot can compare. */
function arrangementKey(store: Store, ids: readonly NodeId[]): string {
  let key = '';
  for (const id of ids) {
    const node = store.getNode(id);
    const h = node?.hints;
    key += `${id}:${node?.lifecycle.state}:${node?.lock?.hide ? 1 : 0}${node?.lock?.resize ? 1 : 0}:${JSON.stringify([h?.size, h?.minSize, h?.maxSize, h?.zoom])};`;
  }
  return key;
}

/**
 * Seams, hiding and zoom for root zones the host lays out itself.
 *
 * It renders one element — class `windease-workspace`, plus `className` — and
 * arranges nothing: where its `<WorkspaceRoot>`s sit is the host's CSS. It
 * measures them, draws the declared `seams` between them, and hands each root
 * the size its seam was dragged to. The arithmetic is `arrangeWorkspace`.
 *
 * @group Components
 */
export function Workspace({
  seams = NO_SEAMS,
  zoom,
  affordances = true,
  affordanceHitPad = 4,
  affordanceKeyStep = 8,
  seamSize,
  joinThreshold,
  className,
  style,
  children,
}: WorkspaceProps) {
  const store = useStore();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [els, setEls] = useState<ReadonlyMap<NodeId, HTMLElement>>(() => new Map());
  const [rects, setRects] = useState<ReadonlyMap<NodeId, Rect>>(() => new Map());
  const [dragging, setDragging] = useState(false);
  const [armedId, setArmedId] = useState<NodeId | null>(null);

  const register = useCallback<Register>((id, el) => {
    setEls((prev) => {
      if (prev.get(id) === (el ?? undefined)) return prev;
      const next = new Map(prev);
      if (el) next.set(id, el);
      else next.delete(id);
      return next;
    });
  }, []);

  const roots = useMemo(() => [...els.keys()], [els]);
  const watched = useMemo(
    () => [...new Set([...roots, ...seams.flatMap((s) => [s.before, s.after])])],
    [roots, seams],
  );
  const key = useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => arrangementKey(store, watched),
  );

  const input: WorkspaceInput = {
    store,
    roots,
    seams,
    rects,
    ...(zoom !== undefined ? { zoom } : {}),
    ...(seamSize !== undefined ? { seamSize } : {}),
    ...(joinThreshold !== undefined ? { joinThreshold } : {}),
  };
  // A drag event must resolve against what is on screen now, not against the
  // render that created the handler.
  const latest = useRef(input);
  latest.current = input;

  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for the store fields the arrangement reads.
  const layout = useMemo(
    () => arrangeWorkspace(latest.current),
    [store, roots, seams, rects, zoom, seamSize, joinThreshold, key],
  );

  const remeasure = useCallback(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    setRects((prev) => {
      const next = measure(wrapper, els);
      return sameRects(prev, next) ? prev : next;
    });
  }, [els]);

  // Every commit: a root moved by a sibling's new size reports no resize of
  // its own. The equality check is what stops this from looping.
  useLayoutEffect(remeasure);

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(remeasure);
    if (wrapperRef.current) ro.observe(wrapperRef.current);
    for (const el of els.values()) ro.observe(el);
    return () => ro.disconnect();
  }, [els, remeasure]);

  const dispatch = useCallback(
    (event: LayoutEvent) => dispatchWorkspaceSeam(latest.current, event),
    [],
  );
  const onActiveChange = useCallback((id: string | null) => setDragging(id !== null), []);
  const shared = useMemo(() => ({ layout, armedId }), [layout, armedId]);

  return (
    <RegisterContext.Provider value={register}>
      <LayoutContext.Provider value={shared}>
        <ResizeGestureContext.Provider value={dragging}>
          <div
            ref={wrapperRef}
            className={className ? `windease-workspace ${className}` : 'windease-workspace'}
            style={style}
            data-workspace-dragging={dragging ? 'true' : undefined}
          >
            {children}
            <AffordanceLayer
              render={affordances}
              affordances={layout.affordances}
              dispatch={dispatch}
              store={store}
              hitPad={affordanceHitPad}
              keyStep={affordanceKeyStep}
              tabStop
              onActiveChange={onActiveChange}
              onJoinArmChange={setArmedId}
            />
          </div>
        </ResizeGestureContext.Provider>
      </LayoutContext.Provider>
    </RegisterContext.Provider>
  );
}

/** Props for {@link WorkspaceRoot}. */
export interface WorkspaceRootProps {
  /** The root node this box holds. */
  id: NodeId;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

/**
 * The box one root of a `<Workspace>` is rendered in, and the element the
 * workspace measures for it. The host's CSS places it; the workspace writes
 * the `width` or `height` a seam was dragged to, and takes it out of view
 * while the root is hidden or another is zoomed. Render the root's own
 * `<Container>` or `<Zone>` inside.
 *
 * `data-workspace-state` is `placed`, `hidden`, `zoomed` or `withheld`.
 *
 * @group Components
 */
export function WorkspaceRoot({ id, className, style, children }: WorkspaceRootProps) {
  const register = useContext(RegisterContext);
  const shared = useContext(LayoutContext);
  if (!register || !shared) throw new Error('<WorkspaceRoot> must be used inside <Workspace>');
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    register(id, ref.current);
    return () => register(id, null);
  }, [register, id]);

  // Before the workspace has heard of this root, only its own lifecycle is
  // known; that is enough to keep a hidden one from painting.
  const hidden = useNode(id)?.lifecycle.state === 'hidden';
  const arranged = shared.layout.roots.get(id);
  const state = arranged?.state ?? (hidden ? 'hidden' : 'placed');
  const size = state === 'placed' ? arranged?.size : undefined;
  const sized: CSSProperties = { ...style };
  if (size?.w !== undefined) sized.width = size.w;
  if (size?.h !== undefined) sized.height = size.h;

  return (
    <div
      ref={ref}
      className={className ? `windease-workspace-root ${className}` : 'windease-workspace-root'}
      style={sized}
      data-workspace-root={id}
      data-workspace-state={state}
      data-join-armed={shared.armedId === id ? 'true' : undefined}
    >
      {children}
    </div>
  );
}
