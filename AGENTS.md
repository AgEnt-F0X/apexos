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

There is no test suite. Verification means `npm run typecheck` plus `verify-pack.ts` for touched data paths.

## Conventions (observed)

- All app code lives in `src/`; path grouping by concern: `data/`, `engine/`, `scene/`, `state/`, `ui/`, `design/`.
- Components are named exports (`export function Foo()`); `App.tsx` is the default export. State via `src/state/appStore.ts` (zustand v5 store `useAppStore`).
- `SessionSource` seam in `src/data/source.ts` hides whether bytes come from a cached `.apx`, IndexedDB, or the worker.
- Assets resolve through `import.meta.env.BASE_URL` (packs at `packs/<key>.apx`); don't hardcode `/`.
- GLSL/Three code in `src/scene/`. Web worker entry is `src/data/sessionWorker.ts` (imported via `new URL('./sessionWorker.ts', import.meta.url)`).
- Commit history: repo currently has no commits (`master`); pre-existing staged/modified/untracked changes at session start — do not amend or reset without asking.

## Pitfalls

- `public/packs/*.apx` is gitignored; a fresh clone has no hero pack and hits the slow worker path. Run `snapshot-session.ts` first or first-visit loads take 1–2 min.
- TypeScript strictness will fail PRs for unused locals/params — strip them.
- Vite dev port is 5199; if something else holds it, the server won't auto-increment (no `--port` override in config).
- `tsconfig.json` includes only `src/`; scripts under `scripts/` are run by `tsx`, not type-checked by `npm run typecheck`.
- OpenF1 windows can 404 under load; `loadSession` retries gaps, so a transient "unrecoverable windows" error usually needs a retry rather than a code change.