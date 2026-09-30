# React Carburetor demo

A Todo app built on the library from this repository: class components only (plus one function
component at the hooks boundary), React 19 + Rsbuild + Tailwind CSS. It exercises the library's
features in the places a real app would need them.

```bash
npm ci
npm start     # dev server
npm run build # production build into ./build
```

The library source lives in `src/Carburetor`, the demo app in `src/ToDo`.

Things worth looking at while clicking around:

- every row shows its own render counter, so editing one todo visibly re-renders one row;
- the list itself reads only the filtered ids and a counters snapshot, which is why it stays put
  while you type in a row;
- the stats pills carry their own counter: switching the filter re-renders the list but not them;
- the fake server answers after 400 ms, so loading, cancel, and the details refresh are visible;
- the emit timestamp in the footer is read by a separate small component, and its store is
  throttled, because it changes on every write.

## Where each feature is used

| Feature | Where |
|---------|-------|
| `Carburetor`: `update`, `draft`, `preEmit`, `setData` | `ToDo/Carburetors/TodoCarburetor.ts` |
| `emitSoon` — publishing from inside another store's notification | `ToDo/Carburetors/UndoCarburetor.ts` |
| `watch(select, onChange)` outside React | `index.tsx` (tab title) |
| `subscribe` for every write (tooling) | `ToDo/Scope/createTodoScope.ts` (emit status), `ToDo/Carburetors/UndoCarburetor.ts` |
| `AntiHookComponent.connect` | `TodoItem`, `ListStatus`, `FilterBar`, `Toolbar` |
| `useCarburetor` | `Components/Footer/EmitStatus.tsx` |
| `connectSelection` + the props gate | `TodoApp.tsx` → `Components/Header/StatsSummary.tsx` |
| `computed`, composed computeds, `useComputed` | `ToDo/Derived/TodoViews.ts`, `TodoApp.tsx` |
| `useEffect` with a cleanup | `TodoApp.tsx` (Ctrl+Z / Ctrl+Y listener) |
| `@bind` | every component handler |
| `transaction` across two stores | `Components/Header/Toolbar.tsx` (clear completed + filter reset) |
| `ResourceCarburetor`: status, abort, reload | `TodoCarburetor.list`, `Components/Footer/ListStatus.tsx` |
| `ResourceCache`, `useResource`, `refresh`, `invalidateAll` | `Scope/createDetailsCache.ts`, `Components/List/TodoDetails.tsx` |
| `CarburetorScope`, `carburetorToken`, `CarburetorProvider`, `ScopedAntiHookComponent` | `ToDo/Scope/`, `index.tsx`, every component |
| `CarburetorHistory` | `ToDo/Carburetors/UndoCarburetor.ts` |
| `persist` | `ToDo/Scope/createTodoScope.ts` (the filter, in `localStorage`) |
| `ComponentUpdateThrottle` | `ToDo/Scope/Tokens/statusToken.ts` |
| `connectDevTools`, `diagnostics` | `index.tsx`, development only |
| `useCarburetorValue`, `useComputedValue` (hooks interop) | `Components/Header/ProgressBadge.tsx` |
| `waitForUpdate` | `__tests__/Demo/ToolingFeatures.test.tsx` |
| `deepClone`, `EResourceStatus` | `TodoCarburetor.ts`, `ListStatus.tsx` |

Not shown on purpose: `suspend()` (the demo keeps explicit loading states instead of Suspense
boundaries) and `CarburetorScope.dehydrate()`/`hydrate()`, which only make sense with server
rendering.
