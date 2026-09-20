# React Carburetor demo

A Todo app built on the library from this repository: class components only, no hooks,
React 19 + Rsbuild + Tailwind CSS.

```bash
npm install
npm start     # dev server
npm run build # production build into ./build
```

The library source lives in `src/Carburetor`, the demo app in `src/ToDo`.

Things worth looking at while clicking around:

- every row shows its own render counter, so editing one todo visibly re-renders one row;
- the list itself reads only `orderIds` and the counters, which is why it stays put while
  you type in a row;
- the emit timestamp in the footer is read by a separate small component, because it changes
  on every write — read state where you render it.
