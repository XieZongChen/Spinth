# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0]

First public release. Spinth is a local-first whiteboard and mind map editor that keeps
documents, undo history and image assets in the browser.

### Added

- Infinite canvas with shapes, text, sticky notes, images, freehand pen and connectors
- Mind maps with tree layout, drag-to-reparent and keyboard navigation
- Multi-select, grouping, align / distribute, rotation and snapping guides
- Rich text with per-selection typography overrides and inline marks
- Undo / redo backed by Yjs and IndexedDB, surviving page reloads
- Content-addressed local asset store with deduplication and garbage collection
- Project files: export and import a portable `.spinth.zip`
- Light and dark themes, 390px mobile layout, installable PWA with offline cache
- Multi-tab safety: single writer with read-only followers
- Runtime-narrowed public API: `createBoard()` returns a frozen projection; the
  development-only debug surface is not part of any production bundle

### Security

- No account system, no telemetry and no third-party scripts on the startup path
