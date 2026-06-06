# Unified Node Model — Phase 4: React Glue Implementation Plan

**Goal:** Hooks (`useNode`, `useNodeSelector`, `useChildren`, `useFocusedNode`, `useRootNodes`, `useNodeStore`), provider (`WindeaseNodeProvider`), and rendering primitives (`NodeRenderer`, `WindeaseNodeRoot`) for the v0.2 node store. DnD pieces (`useDragHandle`, `NodeDragHandle`) move to Phase 5.

**Architecture:** New context `WindeaseNodeContext` carrying `WindeaseNodeStore`. Hooks use `useSyncExternalStore`. `<WindeaseNodeRoot>` reads `rootIds`, dispatches each root through `<NodeRenderer>`. `<NodeRenderer>` looks up the node, calls the chrome handler for its `kind`, recursively renders container children. Chrome handlers receive `{ node, children }` and return ReactNode.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/react/src/v2/NodeProvider.tsx` (new) | Context + provider |
| `packages/react/src/v2/hooks.ts` (new) | useNode, useNodeSelector, useChildren, useFocusedNode, useRootNodes, useNodeStore |
| `packages/react/src/v2/NodeRenderer.tsx` (new) | NodeRenderer + WindeaseNodeRoot + ChromeHandler type |
| `packages/react/src/v2/index.ts` (new) | Sub-package barrel |
| `packages/react/src/index.ts` (modify) | Re-export v2 namespace |
| Tests for hooks and NodeRenderer | (new) |

---

## Tasks

### Task 1: Context + provider

- [ ] Tests: provider exposes store via useNodeStore; missing provider throws.
- [ ] Implement `<WindeaseNodeProvider store>` + `useNodeStore()`.
- [ ] Commit.

### Task 2: Hooks

- [ ] Tests: useNode returns node; updates when store mutates; useChildren returns ordered children; useFocusedNode reacts to focus changes; useNodeSelector returns slice and skips re-renders on irrelevant changes.
- [ ] Implement using useSyncExternalStore.
- [ ] Commit.

### Task 3: NodeRenderer + WindeaseNodeRoot

- [ ] Tests: WindeaseNodeRoot renders root nodes; chrome dispatch routes by kind; container children mount via recursion.
- [ ] Implement.
- [ ] Commit.

### Task 4: Index exports + integration test

- [ ] Re-export under `v2` namespace from react package index.
- [ ] Integration test renders a tree, verifies chrome calls.
- [ ] Commit.
