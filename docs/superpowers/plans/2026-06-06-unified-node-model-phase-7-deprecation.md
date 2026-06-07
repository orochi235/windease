# Unified Node Model — Phase 7: Deprecation & Headline Integration Plan

**Goal:** Mark v0.1 surface as `@deprecated` so editors warn consumers. Add a headline end-to-end integration test that builds, snapshots, hydrates, and renders a v0.2 tree. Actual removal of the v0.1 API waits for a follow-on release that migrates internal consumers (Workspace, Zone, Ladle stories).

**Architecture:** No structural change. JSDoc `@deprecated` annotations on the v0.1 exports. New integration test exercises core → snapshot → core → react end-to-end.

---

## Tasks

### Task 1: Annotate v0.1 exports with `@deprecated`

- [ ] Add JSDoc to: `Store`, `WindowRecord`, `ZoneRecord`, `WindowId`, `ZoneId`, `asWindowId`, `asZoneId`, `createWindowRecord`, `createZoneRecord`, v0.1 React hooks (`useWindow`, `useZone`, `useWindowsByZone`, `useItemMeta`, `useWindease`), `Workspace`, `Zone`, `Provider`.
- [ ] Commit `chore(core,react): mark v0.1 surface as @deprecated for v0.2 migration`.

### Task 2: Headline integration test

- [ ] Build a tree, snapshot, hydrate from snapshot, render via NodeRenderer; verify identical DOM.
- [ ] Commit `test: v0.2 unified node model — headline integration`.
