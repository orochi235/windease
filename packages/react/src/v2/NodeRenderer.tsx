import type { Node, NodeId, NodeKind, WindeaseNodeStore } from '@windease/core';
import { Fragment, type ReactNode } from 'react';
import { WindeaseNodeProvider } from './NodeProvider.js';
import { useChildren, useNode, useRootNodes } from './hooks.js';

export interface ChromeArgs {
  node: Node;
  /** Recursively-rendered subtree if `node` has a container capability,
   *  null otherwise. Chrome handlers decide where in their template to
   *  mount the subtree (e.g. inside a tray region). */
  children: ReactNode | null;
}

export type ChromeHandler = (args: ChromeArgs) => ReactNode;

export type ChromeMap = { [K in NodeKind]: ChromeHandler };

export interface NodeRendererProps {
  id: NodeId;
  chrome: ChromeMap;
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
  const handler = chrome[node.kind];
  return <Fragment>{handler({ node, children: subtree })}</Fragment>;
}

export interface WindeaseNodeRootProps {
  store: WindeaseNodeStore;
  chrome: ChromeMap;
}

export function WindeaseNodeRoot({ store, chrome }: WindeaseNodeRootProps) {
  return (
    <WindeaseNodeProvider store={store}>
      <RootList chrome={chrome} />
    </WindeaseNodeProvider>
  );
}

function RootList({ chrome }: { chrome: ChromeMap }) {
  const roots = useRootNodes();
  return (
    <>
      {roots.map((r) => (
        <NodeRenderer key={r.id} id={r.id} chrome={chrome} />
      ))}
    </>
  );
}
