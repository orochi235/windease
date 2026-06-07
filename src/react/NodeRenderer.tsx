import type { Node, NodeId, WindeaseStore } from '../index.js';
import { Fragment, type ReactNode } from 'react';
import { WindeaseProvider } from './WindeaseProvider.js';
import { useChildren, useNode, useRootNodes } from './hooks.js';

export interface ChromeArgs {
  node: Node;
  /** Recursively-rendered subtree if `node` has a container capability,
   *  null otherwise. Chrome handlers decide where in their template to
   *  mount the subtree (e.g. inside a tray region). */
  children: ReactNode | null;
}

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

export interface NodeRendererProps {
  id: NodeId;
  chrome: Chrome;
}

export function NodeRenderer({ id, chrome }: NodeRendererProps) {
  const node = useNode(id);
  const children = useChildren(id);
  if (!node) return null;
  if (node.lifecycle.state === 'hidden' || node.lifecycle.state === 'destroyed') {
    return null;
  }
  const subtree: ReactNode | null = node.container ? (
    <>
      {children.map((c) => (
        <NodeRenderer key={c.id} id={c.id} chrome={chrome} />
      ))}
    </>
  ) : null;
  const handler = resolveChrome(chrome, node);
  if (!handler) return null;
  return <Fragment>{handler({ node, children: subtree })}</Fragment>;
}

export interface WindeaseRootProps {
  store: WindeaseStore;
  chrome: Chrome;
}

export function WindeaseRoot({ store, chrome }: WindeaseRootProps) {
  return (
    <WindeaseProvider store={store}>
      <RootList chrome={chrome} />
    </WindeaseProvider>
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
