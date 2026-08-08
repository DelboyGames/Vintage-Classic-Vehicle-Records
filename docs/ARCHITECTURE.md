# Architecture

## Purpose

This is a single-user, offline-first Windows desktop application for enthusiasts managing their own vintage and classic vehicles.

## Project layout

- `app/main/` — Electron main process, SQLite persistence, backup, asset and diagnostics services.
- `app/preload/` — secure context bridge between the interface and native Windows services.
- `app/renderer/` — the Collector Edition interface and record-management modules.
- `assets/` — Windows application icon and packaged visual assets.
- `tests/` — fast project smoke tests used before every release build.
- `docs/` — architecture, data-safety and release documentation.

## Data model

The application stores the complete logical state in SQLite and keeps photos and documents in external asset folders. SQLite writes use a temporary file and atomic rename to reduce corruption risk.

## Security model

- `contextIsolation` enabled.
- Node integration disabled in the renderer.
- Sandboxed renderer.
- Native operations exposed only through the preload bridge.
- External web links open in the system browser.
- Optional AES-256-GCM encrypted backup archives.

## Editions

The project produces both:

- a portable Windows executable;
- an NSIS Windows installer.

Both editions use the same source code and database format.
