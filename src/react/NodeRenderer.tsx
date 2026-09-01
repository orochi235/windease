import type { ReactNode } from 'react';
import type { Node, NodeId, Store } from '../index.js';
import { useChildren, useNode, useRootNodes } from './hooks.js';
import { Provider } from './Provider.js';

/** What a {@link ChromeHandler} receives: the node to render, and its
 *  already-rendered subtree when it is a container. */
export interface ChromeArgs {
  node: Node;
  /** Recursively-rendered subtree if `node` has a container capability,
   *  null otherwise. Chrome handlers decide where in their template to
   *  mount the subtree (e.g. inside a tray region). */
  children: ReactNode | null;
}

/**
 * Renders one node's surrounding UI — title bar, borders, whatever the app
 * needs — and decides where `args.children` is mounted inside it. Returning
 * without mounting them hides the whole subtree.
 */
export type ChromeHandler = (args: ChromeArgs) => ReactNode;

/**
 * Map of role-string → chrome handler. Keys come from `node.kind` (a
 * free-form consumer-defined string). When a node has no `kind`, or no
 * handler matches, the renderer looks for a `'default'` handler; failing
 * that, the node renders nothing.
 */
export type ChromeMap = Record<string, ChromeHandler>;

/**
 * Accepts either a single chrome handler (function) or a kind-keyed map.
 * The function form dispatches on whatever the consumer wants; the map
 * form keys on `node.kind` (with `'default'` as a fallback).
 */
export type Chrome = ChromeHandler | ChromeMap;

function resolveChrome(chrome: Chrome, node: Node): ChromeHandler | undefined {
  if (typeof chrome === 'function') return chrome;
  if (node.kind && chrome[node.kind]) return chrome[node.kind];
  return chrome.default;
}

/** Props for {@link NodeRenderer}. */
export interface NodeRendererProps {
  id: NodeId;
  chrome: Chrome;
}

/**
 * Renders the subtree rooted at `id` by handing each node to `chrome`.
 * Hidden and destroyed nodes render nothing, along with their descendants.
 *
 * The imperative counterpart to the `Zone`/`Panel` presets: use this when the
 * tree's shape lives in the store rather than in JSX. Requires a `Provider`
 * above it — {@link Root} supplies one.
 * @group Components
 */
export function NodeRenderer({ id, chrome }: NodeRendererProps) {
  const node = useNode(id);
  const children = useChildren(id);
  if (!node) return null;
  if (node.lifecycle.state === 'hidden' || node.lifecycle.state === 'destroyed') {
    return null;
  }
  const subtree: ReactNode | null = node.container
    ? children.map((c) => <NodeRenderer key={c.id} id={c.id} chrome={chrome} />)
    : null;
  const handler = resolveChrome(chrome, node);
  if (!handler) return null;
  return handler({ node, children: subtree });
}

/** Props for {@link Root}. */
export interface RootProps {
  store: Store;
  chrome: Chrome;
}

/**
 * Mounts a `Provider` for `store` and renders every parentless node through
 * `chrome`. The one-line entry point for a store-driven tree.
 * @group Components
 */
export function Root({ store, chrome }: RootProps) {
  return (
    <Provider store={store}>
      <RootList chrome={chrome} />
    </Provider>
  );
}

function RootList({ chrome }: { chrome: Chrome }) {
  const roots = useRootNodes();
  return (
    <>
      {roots.map((r) => (
        <NodeRenderer key={r.id} id={r.id} chrome={chrome} />
      ))}
    </>
  );
}
