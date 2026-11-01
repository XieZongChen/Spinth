# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.1] - 2026-11-01

### Fixed

- Zoom animations now land exactly on the target scale: pressing zoom N times gives the
  precise `1.2^N` factor instead of stopping 1.6%–3% short. The HUD and the
  level-of-detail thresholds read the same value, so what you see is what the editor
  thinks it is.

### Changed

- Performance benchmarks keep their workload assertions and a 250 ms freeze guard in CI,
  but frame-time deltas are recorded rather than gated: shared runners cannot produce a
  portable measurement. The performance budget is checked locally and manually.

## [1.0.0] - 2026-11-01

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
