# HANDOFF — APEX//OS
*Updated: night of the great track-bake; reconciled 2026-10-17.*
**Read `ROADMAP.md` FIRST** — it is the current verified bar and the production order.
The plan for the anatomy car (2026-10-14) lives in git at
`docs/plans/2026-10-14-anatomy-car-miniature-world.md`. With that basis: Tasks 0–8 + 1.6 + 3.0 + Phase B (B1–B8) are complete and verified.

---

## 0. The project in one breath

APEX//OS replays Formula 1 sessions as an explorable isometric diorama ("the theatre")
wrapped in a porcelain/ink editorial interface, with a metrics engine that derives race
truth (tire deg, consistency, pace-vs-field) from raw telemetry and narrates it honestly.
Design law lives in `PLAN.md` §0; product thesis in `PROJECT.md`; competitive audit in
`AUDIT.md`; last formal audit in `docs/audit-2026-08-14.md`.

**Stack:** Vite + React + TypeScript + three.js (@react-three/fiber), zero UI deps beyond
that by choice. Data from OpenF1 (live/replay telemetry), Jolpica-Ergast (history to 1950),
f1api.dev (circuit lore). One ingestion pipeline feeds two consumers (worker→app, scripts).

## 1. Verified-working state (do not re-litigate)

| System | Status | Evidence |
|---|---|---|
| APEXPACK v4 (+ official `session_result`) | ✅ shipped | `upgrade-packs.ts` migrated both hero packs; truth-check **MATCH**: Brazil `VER→OCO→GAS→RUS→LEC`, Monaco `LEC→PIA→SAI` |
| Backward-compat pack decode (v3 reads as v4 w/ empty results) | ✅ | old packs still load; results header degrades gracefully |
| Metrics engine | ✅ gated | probe-metrics ALL PASS both packs; 34 wet fits / 22 dry fits, zero NaN/slope violations |
| Driver Dossier (`src/ui/Dossier.tsx`, ENGINEER density) | ✅ | scatter w/ classification kinds, stint table, pace trace — all at RaceClock cursor |
| Circuit cache architecture | ✅ | `resolveTrackModel`: static JSON → extrusion fallback; Theatre wired |
| Jolpica + circuitMeta clients | ✅ built, **first consumers live** | `SeasonStandings.tsx` (jolpica championship tables beside the archive) + `MeetingLore.tsx` (circuitMeta lore on the hero + meeting rows). `probe-enrichment.ts` ALL PASS — schema drift in f1api.dev caught & fixed (lowercase `circuit` key, flat "5278km" lengths, colon-millis records, inverted alias map). Both fail soft per house rule #3. |
| Production build | ✅ | `npm run build` green |

### The anatomy car (plan `docs/plans/2026-10-14-anatomy-car-miniature-world.md`, Tasks 0–5 + 1.6 + 3.0)

| Piece | Status | Evidence |
|---|---|---|
| `anatomyModel.ts` (truth module) | ✅ | CAR/WHEEL/COMPOUNDS/DRS constants + pure `brakeReadout/puReadout/tyreReadout/drsReadout` — **no number in the anatomy system may bypass this** |
| `anatomyGeometry.ts` | ✅ | ~100 merged parts, `ANATOMY_ZONES` incl. 0.15 power unit / 0.7 radiator |
| `AnatomyCar.tsx` + `AnatomyHud.tsx` | ✅ | zone-painted shader, wheel/DRS vertex anim, raycast part-picking, HUD reads `sceneRefs.anatomyReadout` at 60 fps |
| Camera + entry | ✅ | `CameraRig` anatomy branch (span 16, 3/4 iso + idle auto-revolve); double-click a focused car, or key `5`; `Escape` restores `anatomyPrevMode` |
| Diorama car rework (`Cars.tsx`) | ✅ | wheel spin, front-wheel steer, low-passed tire heat + glow, PU strip, DRS flap vertex lift. **Deviates from the plan's "widen aState to vec5" — separate `aSpin`/`aHeat` attributes instead; rationale documented at `:92`** |
| Pack v5 (`overtakes` + `starting_grid`) | ✅ | `PACK_VERSION=5`, loader/types/codec + `verify-pack` prints 183 official on-track passes |
| **Visual/runtime verification** | ❌ **STILL NEVER DONE** | every session's browser could not reach the dev port. See `ROADMAP.md` Phase A — this is the owner's 15 min |

## 2. This session's work: the all-circuit track bake

**Owner ask:** tracks must ship *in* the system — no geometry construction per race setup.

**What exists now:**
- `scripts/build-all-tracks.ts` — enumerates every Race 2024→current year on OpenF1,
  filters future/scheduled sessions, keeps ≤3 newest candidates per circuit, pulls each
  through the real loader, extrudes via `buildTrackModel`, writes `public/tracks/<key>.json`.
  Resumable (skips existing). Politeness: `setMinSpacing(2400)` ≈ 25 req/min.
- **Bake complete: 24 circuits in `public/tracks/`** (was "first circuit baked: austin" at
  the time this section was written). Every one telemetry-derived; all lengths within ~2% of
  official. Runtime: a session at a known circuit loads its diorama from static JSON
  instantly — extrusion is fallback-only for unknown/degraded layouts.

### ⚠️ THE critical API lesson (burn this in)

> **OpenF1 returns HTTP 404 for time-bounded queries whose range contains zero rows**,
> and every session's `date_end` overshoots recorded telemetry — so tail windows always
> "404". Also: some edge nodes shed overload as **404 instead of 429**, and the free tier
> enforces **~30 req/min** (not just 3 req/s).
>
> Fix shipped: `fetchRows(..., { allowEmpty404: true })` used by ALL small tables and
> windowed telemetry in `sessionLoader.ts`. Never remove this. Rate pacing knob:
> `setMinSpacing()` in `openf1.ts` — batch jobs MUST raise it; app default stays snappy.

### Bug chain that got us here (all fixed, keep for archaeology)
1. `loadSession(key)` requires `(key, emit)` — progress callback is mandatory
2. Scheduled-but-unrun sessions exist in OpenF1 with keys but no data
3. Rate axis is per-MINUTE too; 404-masquerade defeats naive retry logic
4. Empty-range 404 ≠ error → `allowEmpty404`
5. `loadSession` returns `{ buffer }`, not `{ data }` — scripts must `decodePack`

## 3. Immediate next actions — ALL RESOLVED (2026-08-27)

1. ✅ **Bake complete**: `done: 17 baked, 0 failed, 7 pre-existing` — all 24 run circuits
   in `public/tracks/`, every one telemetry-derived (geo-fallback NOT needed), all lengths
   within ~2% of official. Stray probe files + bake logs deleted per plan.
2. ✅ Static-serving smoke test: `/tracks/<key>.json` serves HTTP 200 JSON via dev server.
   (Human half — loading packs + new sessions in the browser — still worth one pass.)
3. ✅ `git status` review material provided to owner (still zero commits — owner's call).
4. ✅ Strays deleted: `sessions23/24/25.json`, `bake*.log`.

## 4. Open decisions ONLY the owner can make

| Decision | Context |
|---|---|
| **Official turn numbers via livetiming TrackInfo?** | Only source of FIA turn numbers + circuit rotation (FastF1 wraps it). Livetiming is the gray-area source we rejected for session data; a one-time build-time metadata pull is softer but needs sign-off. Until then our T-numbers are labeled data-derived everywhere. |
| **TanStack install** (Query/Table/Virtual) + Bklit | Phase 2 stack gate. Dossier deliberately dependency-free so nothing blocks on this. ThreeUI logged reference-only (aesthetic mismatch). |
| **IndexedDB version bump** | Old v3 cached packs self-heal on reload; bump would force-invalidate. Low priority. |
| **Commit cadence** | Owner-only. Repo currently has zero commits for all recent cycles. |

## 5. Remaining work — full context per item

### Phase 1 leftovers (ingestion platform)
- **probe-endpoints.ts contract tests** — ✅ BUILT AND RUN LIVE: 13 endpoints probed,
  `ALL CONTRACTS HOLD` (11 shape-verified; position/intervals returned empty in the tiny
  test window — allowed, shape still unverified there). Rerun any time upstream drift is
  suspected: `npx tsx scripts/probe-endpoints.ts`.
- **Watermark sync** — ✅ SHIPPED (`src/data/watermark.ts`): per-table high-water marks.
  `bumpWatermark` advances to the newest `date` row (forward-only), `sinceWatermark` injects
  a `date>` filter for incremental refresh, `watermarkAge()` feeds future Pipeline Health
  gauges. Wired into `writeTableCache` (browser small-table path — the worker has no
  localStorage, by design). This is the exact primitive Live mode (§5) polls with. Validated
  live: `npx tsx scripts/probe-csv-watermark.ts` (forward-only, filter injection, no-date
  ⇒ full refetch all pass).
- **CSV bulk mode** (`csv=true`) — ✅ SHIPPED: `fetchRowsCsv()` string → typed-column
  coercion via an explicit `numeric` list; shares the exact rate-lane/backoff behavior via a
  refactored `requestLane()` (JSON + CSV both route through it — one retry policy). Any
  unparseable CSV throws so callers fall back to JSON. Validated live: identical rows to
  JSON (4640/4640) with correct numeric coercion (speed=43, driver_number numeric).
- **Rate-budget ledger** — DOCUMENTED-NOT-BUILT (accepted): PLAN explicitly flags it "Fine.
  Today: scripts set spacing manually." A shared token-bucket only matters if worker+scripts
  ever run concurrently; the bake proved single-pipeline pacing works. Revisit only with Live.
- **Mini-sector (`segments_sector_*`) derivation** — DOCUMENTED-NOT-BUILT (accepted): sector
  analysis is SHIPPED via `duration_sector_1/2/3` (98–100% populated — derivation pass not
  needed). The only true leftover is intra-lap mini-sector detail, which requires re-ingesting
  the segment arrays (new bytes) or building position-param geometry — both flagged optional
  in the audit/handoff. Skipped as marginal vs ingest cost.

### Metrics engine (Phase 1.4 continuation)
- **Gap dynamics family** ← ✅ SHIPPED + VALIDATED (`src/engine/metrics/gapDynamics.ts`):
  per-driver gap-to-leader slope fitted over a GAP_FIT_LAPS=3 window (two-pointer, NaN when
  the window can't span 2 laps) + **battle swings** — sustained (≥3 laps) closes ≤ −0.35 s/lap
  on the car directly ahead while inside 3 s, GREEN FLAG ONLY (caution spans and |rate| > 3
  s/lap are bunching/pit-cycle arithmetic and are excluded — Brazil '24 chaos correctly
  yields 0 swings, Monaco '24 yields 5 real closes). Cursor read `gapSlopeAt()`. Wired into
  MetricsModel.gapDynamics; Dossier vitals gained a live GAP·TREND read.
- **Drama index v2** ← ✅ SHIPPED: (1) battle swings feed the Moments Engine as hedged
  `battle_swing` moments (icon ↗, amber, note "prediction from gap trend"); (2) stakes
  weighting — moments involving eventual podium finishers (v4 results table = named source)
  get severity ×1.25 into the drama curve. Probe gates: slopes computed field-wide, drift
  and medians physically sane.
- **Track evolution** ← ✅ SHIPPED (`trackEvolution.ts`): field median clean lap per race lap
  (≥3 drivers), fitted drift. Probe: Brazil −0.125 s/lap (drying track ✓), Monaco −0.056
  (procession ✓). `fieldMedianAt()` cursor read.
- **Sector analysis** ← ✅ SHIPPED (`sectors.ts`): uses `duration_sector_1/2/3` (98-100%
  populated in packs — derivation pass NOT needed); per-driver median/best + field-best trio
  + `sectorDeltaAt()` vs benchmark + honest availability counts. Mini-sector segments remain
  dropped at ingest (would need the derivation pass, PLAN §1.2).
- **Narration hedging** ← ✅ SHIPPED (audit point closed): `Narration.hedge` surfaces a
  moment's honesty conditions as small print (`m.note`): undercut cycle-phase swaps and
  battle-swing predictions both hedge ("the pass is not guaranteed"); 'unclear' outcomes
  still never narrated.
- **Undercut metric** ← ✅ SHIPPED + REAL-DATA VALIDATED (`src/engine/metrics/undercut.ts`,
  wired through `metricsFor()`): classifies green-flag pit stops made within
  `UNDERCUT_MAX_GAP_S` (2.5s) of the car ahead as attempts; success/fail settled via
  position at pit-lap +2; `outLapDelta` measures whether the tire offset converted;
  `targetAlsoPitted` hedges cycle-phase swaps. **Caution stops excluded** — SC/VSC/RED pits
  are free stops, matched by wall-clock AND by caution LAP window (OpenF1 logs suspended-
  race service stops after the span ends; Monaco '24 proved wall-time alone insufficient).
  'unclear' outcomes never narrated. Validated: synthetic 11/11 (`probe-undercut.ts`);
  hero packs ALL GATES PASS via `probe-metrics.ts` — Brazil '24: 1 attempt (LEC→HUL L24,
  the 6 SC-cycle stops correctly filtered), Monaco '24: 0 attempts (red-flag mass stops
  correctly filtered). Feeds Moments (type 'undercut', icon ⇄) + Dossier UNDERCUT LEDGER
  with live threat row.
- **Gap dynamics family** — gap-to-leader slope per stint from `intervals` table;
  powers battle prediction and DNA strip enrichment.
- **Sector analysis** — `segments_sector_*` channels are currently DROPPED at ingest
  (see loader). Sector deltas need either re-ingest with sectors kept OR derive from
  position params at sector boundaries (trackBuilder already computes sectorParam!).
  Derivation preferred: zero new bytes.
- **Drama index v2** — now unblocked: `results` table adds championship stakes context;
  combine with gap dynamics + flag timeline. Keep narration hedged (audit finding:
  narrate.ts never hedges low confidence).
- **Track evolution** — lap-time medians vs stint order across field; cheap, feeds
  strategy storytelling.

### Phase 2 (dashboard) — stack decision then surfaces
- ✅ **First enrichment consumers shipped dependency-free** (Dossier precedent — nothing
  blocks on the TanStack decision): `SeasonStandings.tsx` = first **jolpica consumer**
  (driver top-10 + constructor top-5 championship tables for the selected archive year);
  `MeetingLore.tsx` = first **circuitMeta consumer** (length/turns/lap-record lore on the
  hero card + expanded meeting rows). Validated live by `scripts/probe-enrichment.ts`
  (ALL PASS). Remaining surfaces (head-to-head compare, results table, race-picker cards
  with Bklit charts) still gate on the TanStack/Bklit install decision.
- Install decision above, then: Standings & Seasons surface (first **jolpica consumer**),
  race picker cards (first **circuitMeta consumer** — lap records/corner counts on
  session cards), head-to-head compare panel (shares selection state w/ ghost mode),
  results table using v4 `results`.
- Component kit: adapt Bklit charts behind `src/ui-kit/` styled by tokens.css only.

### Phase 3 (theatre upgrades) — see PLAN table
- Cached ribbons for all circuits (unlocked by tonight's bake)
  - **Geo-fallback now exists**: `npx tsx scripts/build-tracks-from-geojson.ts` fills any
    circuit whose telemetry bake exhausted candidates (e.g. jeddah 2026) by tracing
    bacinger/f1-circuits GeoJSON (MIT, static GitHub file — no rate limit). Writes
    `source:'geojson'` snapshots: corners from curvature ✓, but brakeHeat honestly zeroed,
    sectors ≈ thirds, flat profile. NEVER overwrites a telemetry bake (default = fill gaps
    only; `--dry` validates without writing). Dry-run accuracy vs official lengths:
    zandvoort −0.1%, suzuka +0.1%, spa −0.4%, silverstone −0.2%, interlagos −0.3%.
- Driver tags/pips/crown/DRS pips w/ density-governed LOD; raycast selection feeding
  FocusPanel + Director cam; `[ ]` keyboard cycling; comparison ghost ribbons
- **Simulated Safety Car specimen** (from f1-race-replay): amber SC riding ribbon ahead of
  leader during SC/VSC phases, pit-entry/exit easing; MUST be flagged simulated in X-ray
- Undercut honesty pass = metrics item above

### Phases 4–5
Browser v2 (cards, seasons), about/onboarding polish, then LIVE mode: polling transport,
Join-as-Live with spoiler veil, TV-sync delay slider (undercut-f1 idea), staleness UX.
Live timing tower conventions studied from f1-dash.

## 6. File map (where things live)

```
src/data/        openf1.ts (queue/rate/404 semantics!) · sessionLoader.ts (pipeline,
                 normalizeResults shared w/ scripts) · pack.ts (v5 codec: +overtakes/starting_grid)
                 · jolpica.ts · circuitMeta.ts · circuitCache.ts · cache.ts (IndexedDB)
                 · watermark.ts (per-table high-water marks — LiveSource's primitive)
src/engine/      metrics/ (classify·tireDeg·consistency·pace·undercut·gapDynamics·
                 sectors·trackEvolution·index) · raceState.ts · flags.ts · moments.ts ·
                 narrate.ts · RaceClock.ts
src/scene/       trackBuilder.ts (+serialize/modelFromCached) · Theatre/Cars/CameraRig/
                 BattleBridges/DNA/Xray · PostFX.tsx (tone mapping + shed ladder, owns
                 postprocessing/n8ao) · sceneRefs.ts (widthGain coupling + anatomy
                 sample/readout/part/entryPoint/prevMode — the Roadmap-cross-module bus)
                 · ANATOMY LAYER: anatomyModel.ts (the truth module — CAR/WHEEL/COMPOUNDS
                 + brakeReadout/puReadout/tyreReadout/drsReadout) · anatomyGeometry.ts
                 (~100 parts, ANATOMY_ZONES incl 0.15 PU / 0.7 radiator) · AnatomyCar.tsx
                 (zone-painted shader, wheel/DRS vertex anim, raycast part-picking)
                 · TracksideDressing.tsx (pit lane, garages, perches, grandstands) · pitModel.ts (pit glow) · isoPlane.ts (kernel) · TrackFurniture.tsx
src/ui/          Shell · SessionBrowser · LoadingScreen · FocusPanel · Dossier · TimingTower…
                 · AnatomyHud.tsx (live part readouts + quick-select chips + L-light toggle) · CalloutLayer.tsx (SVG hairline apex leader lines, gate markers, hover proximity) · workshopAudio.ts (Web Audio synthesizer)
scripts/         snapshot-session · upgrade-packs (v3→v4→v5 pattern) · verify-pack ·
                 probe-metrics · probe-undercut · probe-endpoints · probe-enrichment ·
                 probe-csv-watermark · build-tracks · build-all-tracks · build-tracks-from-geojson ·
                 audit-theatre-iso (isometric contract gate — see docs/audit-isometric-2026-08-27)
public/tracks/   baked geometry snapshots (24 circuits)
docs/            ROADMAP.md (CURRENT BAR — read first) · audit-2026-08-14.md ·
                 audit-isometric-2026-08-27.md · plans/2026-10-14-anatomy-car-miniature-world.md
```

## 7. House rules that must survive any refactor

1. One pipeline, two consumers — never fork normalization (share via exports like
   `normalizeResults`).
2. Every number displayed traces to `metricsFor()` or a named table — no vibes.
3. Enrichment sources may never block core loads (jolpica/circuitMeta fail soft).
4. Porcelain design law: hairlines not cards, ink hierarchy, ONE red voice, mono data.
5. Simulated entities must self-declare in X-ray lineage.
6. Owner commits, AI never does.
7. **Plans live in git** — `docs/plans/`, referenced from this file. The 2026-10-14 anatomy
   plan lived only in the untracked `.hermes/plans/` and was invisible to every doc.
