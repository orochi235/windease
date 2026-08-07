// Ladle bundles the stories' plain CSS; TS 6 (TS2882) requires side-effect
// imports to resolve to *something*. Scoped to this dir so the published build
// (which excludes stories/) never gains a blanket '*.css' module declaration.
declare module '*.css';
