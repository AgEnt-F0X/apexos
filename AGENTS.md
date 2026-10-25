# AGENTS.md — APEX//OS

F1 spatial race intelligence engine. React 19 + three.js/r3f + zustand + custom GLSL, built with Vite 8, strict TypeScript 6. Single-page app at `src/App.tsx`; telemetry ingested from OpenF1 into an APEXPACK binary cached in IndexedDB. Port is fixed at 5199.

## Dev environment

- `npm install` once. `node_modules/` present; no lint/formatter/test harness configured.
- Backend: none. Data source is the public OpenF1 API (no env vars / keys).
- Hero pack: `public/packs/9636.apx` is the 2024 São Paulo GP snapshot and is gitignored (`public/packs/*.apx`); regenerate with `npx tsx scripts/snapshot-session.ts 9636`.

## Build & test

- `npm run dev` — Vite dev server on http://localhost:5199
- `npm run typecheck` — `tsc --noEmit` (strict, `noUnusedLocals`/`noUnusedParameters` enforced; read `tsconfig.json` before editing)
- `npm run build` — `tsc --noEmit && vite build` (typecheck gates the build; worker format is `es`)
- `npm run preview` — preview production build
- `npx tsx scripts/snapshot-session.ts [sessionKey]` — rebuild a hero pack (default 9636); ~1–2 min cold fetch
- `npx tsx scripts/verify-pack.ts [sessionKey]` — decode a pack and print verifiable facts for truth-checking against the historical record
- `npx tsx scripts/make-demo-pack.ts` — regenerate `public/packs/9595.apx`, the synthetic demonstration Grand Prix (Interlagos, 55 laps, SC + rain arc). Bundled and committed: it is the always-open door when OpenF1 is locked or offline. `src/ui/SessionBrowser.tsx` exports it as `DEMO`; StatusBar shows the SIMULATION badge for it; keep every copy of session 9595 labelled as simulated.

There is no test suite. Verification means `npm run typecheck` plus `verify-pack.ts` for touched data paths.

## Conventions (observed)

- All app code lives in `src/`; path grouping by concern: `data/`, `engine/`, `scene/`, `state/`, `ui/`, `design/`.
- Components are named exports (`export function Foo()`); `App.tsx` is the default export. State via `src/state/appStore.ts` (zustand v5 store `useAppStore`).
- `SessionSource` seam in `src/data/source.ts` hides whether bytes come from a cached `.apx`, IndexedDB, or the worker.
- Assets resolve through `import.meta.env.BASE_URL` (packs at `packs/<key>.apx`); don't hardcode `/`.
- GLSL/Three code in `src/scene/`. Web worker entry is `src/data/sessionWorker.ts` (imported via `new URL('./sessionWorker.ts', import.meta.url)`).
- Commit history: repo currently has no commits (`master`); pre-existing staged/modified/untracked changes at session start — do not amend or reset without asking.

## Pitfalls

- `public/packs/*.apx` is gitignored EXCEPT `9595.apx` (the demo pack ships with the repo). Hero packs for real sessions are regenerated with `snapshot-session.ts`.
- **OpenF1 live-session lockdown (2026):** during a running F1 session the whole API — including the historical archive — answers 401 to keyless clients until the session ends. The app handles this: `SessionBrowser` explains the lock and features the demo session; `openf1.ts` maps 401 to a plain-language error. Don't "fix" a 401 in code — retry after the session or use the demo pack.
- TypeScript strictness will fail PRs for unused locals/params — strip them.
- Vite dev port is 5199; if something else holds it, the server silently moves to another port (5199 must be free — kill stale node processes before restarting on Windows).
- `tsconfig.json` includes only `src/`; scripts under `scripts/` are run by `tsx`, not type-checked by `npm run typecheck`.
- OpenF1 windows can 404 under load; `loadSession` retries gaps, so a transient "unrecoverable windows" error usually needs a retry rather than a code change.
- The theatre's frame loop freezes with the tab's compositor (RAF): a "frozen race clock" in an automated/headless browser is usually the environment, not the clock.