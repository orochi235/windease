# @windease/react

React bindings for [windease](https://github.com/orochi235/windease).

```sh
npm install @windease/core @windease/react
```

Peer-depends on `react@^19`.

Provides `<WindeaseNodeProvider>`, `<StrategyRegistryProvider>`,
`<NodeContainer>`, `<NodeDragProvider>`, hooks (`useNode`, `useChildren`,
`useFocusedNode`, `useActivity`, …), and the DnD primitives
(`<NodeDragHandle>`, `useNodeDropTarget`, …).

Import the baseline structural stylesheet once at the top of your app:

```ts
import '@windease/react/styles.css';
```

Docs and a live playground: <https://github.com/orochi235/windease#readme>.
