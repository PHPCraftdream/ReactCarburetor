# Documentation examples

`buildDocs.mjs` synchronizes marked TypeScript and JavaScript fences in `README.md` and `docs/` from their source files. Markdown under top-level `reviews/` and `checkpoints/` is excluded.

A whole-file source marker sits immediately above the fence:

````md
An example marker sits immediately above its fence:

```md
<!-- example:file examples/readme/Counter.tsx -->
```tsx
...
```
```
````

For an excerpt, put matching `// #region name` and `// #endregion name` lines in the source and append `#name` to the marker path (e.g. `<!-- example:file examples/region.tsx#view -->`). Region lines are omitted from the fence. Supported extensions are `.ts`, `.tsx`, `.js`, and `.jsx`; indentation is normalized and surrounding Markdown line endings are preserved. Every target-language fence must carry a marker.

Run `node scripts/tools/buildDocs.mjs` to update marked fences, or add `--check` to aggregate missing markers, mismatches, malformed fences, and unsafe paths without writing. The check is strict: any unmarked `ts`/`tsx`/`js`/`jsx` fence is an error, with no allowlist.
