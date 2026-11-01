# Spinth

**Local-first whiteboard and mind map editor. Everything stays in your browser.**

[English](./README.md) · [简体中文](./README.zh-CN.md)

Spinth is an infinite canvas for shapes, text, sticky notes, images, freehand drawing,
connectors and mind maps. Documents, undo history and image assets live in the browser
(IndexedDB): there is no account, no server and no telemetry.

**[Open the live demo →](https://xiezongchen.github.io/Spinth/)**

## Features

- Infinite canvas with rectangles, text, sticky notes, images, freehand pen and connectors
- Mind maps with tree layout: drag a node to re-parent, keyboard navigation, inline editing
- Multi-select, grouping, align / distribute, rotation and snapping guides
- Rich text editing with per-selection typography overrides and inline marks
- Undo / redo backed by a Yjs document plus IndexedDB, surviving page reloads
- Content-addressed local asset store: images are deduplicated, documents keep short refs
- Project files: export and import a portable `.spinth.zip`
- Light and dark themes, 390px mobile layout, installable PWA with offline cache
- Multi-tab safety: a single writer owns the document, other tabs follow read-only

## Quick start

```bash
pnpm install      # Node >= 24, pnpm 11.28.5
pnpm dev          # http://localhost:5173
pnpm build        # production build with service worker
pnpm test         # unit tests
pnpm test:e2e     # Playwright end-to-end suites
pnpm verify       # hygiene + lint + format + typecheck + licenses + unit + build
```

## Architecture

| Package          | Role                                                   |
| ---------------- | ------------------------------------------------------ |
| `packages/core`  | `@spinth/core` — framework-agnostic SDK (PIXI 8 + Yjs) |
| `packages/react` | `@spinth/react` — read-only zustand mirror plus DOM UI |
| `packages/app`   | `@spinth/app` — Vite application shell                 |

Three invariants keep the data path honest:

1. Every write goes through Yjs; rendering only subscribes to Yjs.
2. `core` never imports a UI framework, `react` never touches PIXI or Yjs directly,
   `app` consumes `react` only.
3. No server, account or remote sync sits on the startup path — the offline
   single-device experience is the product, not a fallback.

Implementation notes and specifications live in [`docs/`](./docs/README.md).

## Browser support

Spinth needs IndexedDB, WebGL and — for the offline cache — Service Worker support.
Chromium is the automated baseline: every end-to-end and visual test runs there.
Firefox and Safari are expected to work but are not covered by CI yet.

## Privacy

- No account, no sign-up, no analytics, no third-party scripts.
- Documents, undo history and images stay in the browser's local storage.
- Nothing is uploaded; exporting a `.spinth.zip` is the only way data leaves the machine.
- Clearing site data deletes your boards — export first if you need a backup.

## Deployment

Static hosting is enough. For a sub-path deployment such as GitHub Pages, inject the base
path at build time and verify the artifact:

```bash
SPINTH_BASE=/Spinth/ pnpm build
node scripts/check-pages-build.mjs packages/app/dist /Spinth/
```

## Contributing

Issues and pull requests are welcome. Please read [CONTRIBUTING.md](./CONTRIBUTING.md)
first: the repository is gated by `pnpm verify`, and commits are expected to carry a
Developer Certificate of Origin sign-off (`git commit -s`).

## License

[MIT](./LICENSE). Third-party licenses are listed in
[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
