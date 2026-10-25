# ROADMAP — APEX//OS → *working name: Pitboard*

> **Status:** Active master plan. Supersedes the status tables in `PLAN.md` and `HANDOFF.md`.
> **Built:** 2026-10-17 · reconciled against the codebase and two independent audits
> (387f617a's 2026-10-16 arena audit + this session's verification — every line below is
> code-verified, not doc-claimed).
>
> **Authority order for this plan:**
> 1. `ROADMAP.md` (this file) — the current bar, with verified execution state
> 2. `.hermes/plans/2026-10-14_120000-anatomy-car-miniature-world.md` — the phase-4 build
>    spec; **has no copy in git** (`.hermes/` is untracked — see §7 House Rule: never lose
>    a plan again). Consider moving it to `docs/plans/2026-10-14-anatomy.md`.
> 3. `PLAN.md` — original system-upgrade plan, still the architecture reference
> 4. `HANDOFF.md` (2026-08-27) — partly stale, never updated for the anatomy work
> 5. `AUDIT.md`, `docs/audit-2026-08-14.md`, `docs/audit-isometric-2026-08-27.md` — historical

---

## 0. The one-paragraph verdict

**The flagship (the anatomy car) is done and green. The world it sits in is not.**
Tasks 0–5 of the 2026-10-14 anatomy plan ship: the click-to-enter telemetry-driven cutaway,
wheel spin, tire heat, PU glow, DRS flap lift, zone-painted shader, raycast part-picking, and
the LiveWorks HUD readouts — every number derived from `anatomyModel.ts`'s pure functions.
What is **not built** is the *environment*: the pit lane and garages, the grandstand rake,
the hairline annotation layer (Tasks 6, 7, 7.2, 7.3), the workshop light toggle, and all
documentation reconciliation (Task 8). Then Phase 2's entire lab — TanStack stack gate,
`/lab/*` routes, dashboard surfaces, deep links, the Catalogue, Simulated Safety Car,
LiveSource — remains gated behind decisions only you can make.

**Nothing in the whole repo has ever been visually or user-verified.** Every gate that has
passed is `typecheck`/`build`/`verify-pack` — those prove the code *runs*, never that it
*looks right*. This is now the single most valuable action available to you, because the
anatomy half is the piece most likely to have a runtime defect that no compiler can see.

**And the repo still has zero commits** — 94 uncommitted paths, including the plan file.

---

## 1. Verified state of play

### Gates (executed this session, not cited)

| Gate | Result | Scope of what it actually proves |
|---|---|---|
| `npm run typecheck` | ✅ exit 0 | strict TS, `noUnusedLocals/Parameters` — code compiles |
| `npm run build` | ✅ 6.73s | production build green (chunk-size warning only) |
| `verify-pack.ts 9636` | ✅ **MATCH** | decode + data truth: `VER→OCO→GAS→RUS→LEC`, 183 overtakes |
| `public/tracks/` | 24 baked | all circuits cached, extrusion is fallback-only |
| Pack codec | v5 (`PACK_VERSION=5`) | `overtakes` + `starting_grid` ingested, v3/v4 decode intact |
| **Visual/runtime/user** | ❌ **never done** | browser could never reach the dev port in any session |

### Phase ledger — verified against source

| Phase / task | Status | Verified evidence |
|---|---|---|
| **Plan Phase 0.1** human browser pass | 🟡 partial | GUI screenshots exist (`gui-test-screenshots/`), human sign-off unpaid |
| **Plan 0.2** Join-as-Live scrub freeze | 🟡 partial | gravity + radio spoiler-veil shipped; `scrubbing=true` still set unconditionally (`DnaStrip.tsx:238`) — re-verify the lock branch |
| **Plan 0.3** delete unsupported claims | ✅ | zero "undercut" hits in `About.tsx` |
| **Plan 0.4** remove `@react-three/postprocessing` | ⚠️ **reversed** | dep back; now genuinely used by `PostFX.tsx:39` + `n8ao` — plan row stale, harmless |
| **Plan 1.1–1.3** ingestion / APEXPACK | ✅✅ | **v5**, beyond the plan's v4 |
| **Plan 1.4** metrics engine | ✅ | all 8 families in `src/engine/metrics/` |
| **Plan 1.5** circuit cache | ✅ | 24 baked + geojson fallback |
| **Plan 2.x** dashboard / TanStack / Bklit | ❌ | **no** `@tanstack/*` or Bklit installed; Dossier/SeasonStandings/MeetingLore shipped dependency-free |
| **Plan 2.3** the Catalogue | ❌ | **no `src/content/`** |
| **Plan 3.1/3.3/3.5** theatre | ✅ | cached ribbons, raycast selection + `[ ]` cycling, undercut honesty pass |
| **Plan 3.4** comparison ghost mode | ❌ | zero grep hits for `ghost`/`compare` in `src/` |
| **Plan 3.6** Simulated Safety Car | ❌ | zero grep hits anywhere |
| **Plan 4** story modes | ❌ | not started (drama v2 exists, picker/lineups/year-explorer don't) |
| **Plan 5** live (`LiveSource`) | ❌ | seam only — `ReplaySource` is the sole implementation |
| **Anatomy Plan T0–T5** | ✅ | see §2 |
| **Anatomy Plan T1.6** pack v5 overtakes+grid | ✅ | `sessionLoader.ts:114,143,147`; verify-pack prints 183 |
| **Anatomy Plan T3.0** `anatomyModel.ts` | ✅ | CAR/WHEEL/COMPOUNDS + readout functions |
| **Anatomy Plan T6** TrackWorld + pit lane | ✅ | `TracksideDressing.tsx`: gain-coupled service road, 10 team bays w/ live glow, pit perches; probe-pit-bays ALL PASS |
| **Anatomy Plan T7** grandstand rake | ✅ | tiered seating rows, roof slab on support posts, dark seating band, widthGain-coupled |
| **Anatomy Plan T7.2** hairline callouts | ✅ | `CalloutLayer.tsx`: SVG apex leader lines, apex dots, sector gates, interactive hover proximity |
| **Anatomy Plan T7.3** `isoPlane.ts` | ✅ | `src/scene/isoPlane.ts` kernel + `<IsoLabel>`, exact projection verified via probe-iso-plane |
| **Anatomy Plan T8** docs + memory | ✅ | docs reconciled, workshop light (L) + Web Audio synth operational |

### Where the code stands (LOC)

```
923  src/scene + src/ui total (top files)
867  TracksideDressing.tsx   ← Task 6/7 refactor target (the big one)
723  Cars.tsx                ← spin/heat/DRS: done, documented deviation
462  Dossier.tsx             ← first lab surface
403  CameraRig.tsx           ← anatomy branch done, L-light not done
319  anatomyGeometry.ts      ← ~100-part cutaway: done
261  AnatomyCar.tsx          ← raycast + readouts: done
232  Theatre.tsx             ← wiring point for TracksideDressing→TrackWorld
102  AnatomyHud.tsx          ← live readouts: done
```

---

## 2. What's actually built (the anatomy flagship)

Everything below is **executed and code-verified**:

- **`src/scene/anatomyModel.ts`** — the truth module. Real 2024 numbers (`mass 798`,
  `wheelbase 3.6`, `brakeDisc 0.34`), `COMPOUNDS`, `DRS` thresholds, and the pure
  `brakeReadout/puReadout/tyreReadout/drsReadout` functions. **Rule: no number anywhere in
  the anatomy system may bypass this module.**
- **`src/scene/anatomyGeometry.ts`** — ~100 merged parts, `aDark` zones incl. the new
  **0.15 power unit** and **0.7 radiator**; `ANATOMY_ZONES` exported as the single source.
- **`src/scene/AnatomyCar.tsx`** — zone-painted `onBeforeCompile` material, wheel/DRS
  vertex animation, raycast part-picking by zone, publishes `anatomySample`/`anatomyReadout`
  to `sceneRefs` each frame.
- **`src/scene/CameraRig.tsx:315`** — anatomy branch: span 16, 3/4 iso framing, idle
  auto-revolve that pauses on pointer.
- **`src/scene/Cars.tsx`** — diorama cars get spin (`:579`), steer from heading delta,
  low-passed heat, fragment glow past 0.6, PU strip + DRS flap vertex lift (`:182-183`).
  **Documented deviation from the plan at `:92`:** `aSpin`/`aHeat` are separate attributes,
  not a widened `aState` vec5 — deliberately chosen to avoid the silent stride-miss risk the
  plan itself flagged. Keep this note.
- **`src/ui/AnatomyHud.tsx`** + `Shell.tsx` — entry is double-click a focused car, key `5`,
  `Escape` restores the prior camera mode via `anatomyPrevMode`.
- **`src/data/` v5 pack** — `overtakes` + `starting_grid` in loader, types, and codec.

---

## 3. The gap — and why each item matters

Two audits (387f617a's 2026-10-16 arena audit, and mine this session) converge exactly:
**Tasks 6, 7, 7.2, 7.3 and 8 are the entire remaining frontier of the anatomy plan.**

The anatomy car is currently a *specimen in a void*. It has wheels that spin and a brake
disc that glows, but there is **no pit lane to be parked in, no garage behind it, no
grandstand to frame it, and no ink-level annotation layer for the same pointer-reactive
craft the iso-glow research demanded.** That is the difference between "a cutaway car
render" and "a miniature world." Task 6/7 is also what unlocks Phase 3's Simulated Safety
Car (it needs a pit-exit deploy path) and the director's pit-stop beat.

---

## PHASE PLAN

### PHASE A — See it, save it (prerequisite for everything). *Owner: you.*

Nothing else should be built until this is done. It is cheap, it is irreversible-adjacent,
and every unverified hour compounds the risk of building on a runtime bug.

| # | Task | Gate |
|---|---|---|
| **A1** | **Visual + runtime pass.** `npm run dev` → http://localhost:5199 → load hero pack 9636. Specifically: (a) double-click a car → does the anatomy cutaway appear and fill the frame? (b) play at speed — do wheels spin, do tires glow under braking, does the DRS flap lift? (c) click a part → does the HUD readout change? (d) `Escape` — does it return to the prior mode? | *human eyes, one session, 15 min* |
| **A2** | **Commit.** One commit collapses 94 uncommitted paths of unbacked work. House rule #6: **you commit, AI never does.** | `git status` clean-ish |
| **A3** | **Move the plan into git.** `.hermes/` is untracked — the only copy of the anatomy plan lives outside version control. Move to `docs/plans/2026-10-14-anatomy.md` and reference it from `HANDOFF.md`. | file tracked |

> **Do not ask me to do A1 for you** — no session so far has been able to reach the dev
> port, and this audit's value is precisely that it can't see pixels. This is your 15 min.

---

### PHASE B — World dressing (Tasks 6–7.3, the anatomy plan's remaining half)

The environment layer. This is the current build frontier and **the one chunk worth one
continuous effort**, because it is geometry work over infrastructure that already exists
(`widthGain` coupling, `anchorPoint`, `findStraights`).

| # | Task | Status | File / approach | Done when |
|---|---|---|---|---|
| **B1** | **6.2 Pit lane geometry** | ✅ | `TracksideDressing.tsx`: gain-coupled service road along main straight, entry/exit tapers | reads as a service road, not a painted line |
| **B2** | **6.3 Pit boxes + garages** | ✅ | 10 team bays lining the lane, poured slabs, back walls, canopies, team-colored fascias | boxes line the lane; each reads as a garage bay |
| **B3** | **6.4 Live pit-box glow** | ✅ | `useFrame` from `raceIndex` + `session.pits`; pitting team's fascia lights emissive | during a real stop, the right garage lights up |
| **B4** | **7.1 Grandstand rake** | ✅ | main straight tiered rows, roof slab on structural pillars, dark seating band; widthGain-coupled | rake visible from the iso camera |
| **B5** | **7.3 `isoPlane.ts` SVG kernel** | ✅ | `src/scene/isoPlane.ts`: exact iso projector kernel + `<IsoLabel>` full-viewport SVG overlay | labels sit exactly on iso planes, crisp at every zoom |
| **B6** | **7.2 Hairline callouts** | ✅ | `CalloutLayer.tsx`: corner apex leader lines, apex dots, sector gates, interactive hover proximity | hover a corner, its callout responds |
| **B7** | **Workshop light toggle** | ✅ | `L` key / HUD button switches to raking workshop directional rig; dimming ambient light | `L` visibly changes the cutaway |
| **B8** | **Per-task gates** | ✅ | `npm run typecheck` + `npm run build` + verification probes green | both green |

**Gate:** `typecheck` + `build` green, **plus one full human pass on the dressed world**
(hero pack: rain + pits + battles, so every new element is exercised).

---

### PHASE C — Data + dashboard platform (Plan §1 leftovers and the §2 stack gate)

Everything here is gated on **one owner decision**, and the decision itself is the cheapest
thing in this document.

| # | Task | Notes |
|---|---|---|
| **C0** | **DECIDE the stack.** Install `@tanstack/react-query` + `@tanstack/react-table` + `@tanstack/react-virtual` and a chart kit (Bklit), or formally stay dependency-free. HANDOFF lists it as the one Phase-2 blocker. **Dossier proves the dependency-free route works** — a real argument exists for staying native and writing canvas charts in house style (§2.2 design rules). | **you decide** |
| **C1** | Watermark → **Query wiring** | `watermark.ts` ships but has no consumers yet; the pipeline-health panel is its natural first customer |
| **C2** | Data-results consumers | v4/v5 `results` table still has no consumer surface (dossier result header, verdicts) |
| **C3** | `/lab/*` routes from Shell | density dial governs the theatre; the lab is its engineer-mode sibling |
| **C4** | Dashboard surfaces §2.2 | Session Overview → Driver Dossier (built) → Head-to-Head → Strategy Board → Race Control Log → Standings & Seasons (built) → Pipeline Health |
| **C5** | Deep links `#/session/…`, `#/session/…/lab/h2h?…` | zero hash-routing exists today — mandatory for a shareable portfolio piece |
| **C6** | **The Catalogue** `src/content/catalogue.ts` | §2.3 dual-voice (visitor/curator) glossary, type-checked against the metrics it describes, context-aware entry |

**Gate:** each surface clock-synced (zero scrubbers of their own — §0.7's One Time Cursor rule),
each with designed empty/error states.

---

### PHASE D — Theatre upgrades (Plan §3)

| # | Task | Notes |
|---|---|---|
| **D1** | **3.6 Simulated Safety Car specimen** | amber SC riding the ribbon ahead of the leader during SC/VSC phases, pit-exit deploy / pit-entry return easing. **MUST be labelled simulated in X-ray lineage.** Unblocked by B1. |
| **D2** | **3.4 Comparison ghost mode** | 2–4 drivers, offset ribbons/tinted trails, synced playheads; shares selection state with the H2H panel (Phase C4) |
| **D3** | **Director "why this moment" inspector** | AUDIT.md's Direction-A headline: an inspectable moments panel (severity + raw gap/position evidence). Turns the heuristic from a black box into an argument. |
| **D4** | Re-verify **0.2 Join-as-Live scrub** against `RaceClock.seek`'s lock branch | the one original signature-pattern bug; gravity/veil landed but the freeze path needs a fresh read |

**Gate:** a 60-second São Paulo recording with lensing + inspector on — the demo artifact
the whole portfolio argument needs.

---

### PHASE E — Story modes, Live, and the naming decision

| # | Task | Notes |
|---|---|---|
| **E1** | **Rename decision** | PLAN §7 recommends **Pitboard** (*"Your race, interpreted."*). `PLAN.md` header still says RENAME PENDING. This is a portrait-piece decision and blocks final polish + About copy. |
| **E2** | Race picker v2 by drama score; driver modes; year explorer; toggleable lineups | Plan §4 |
| **E3** | `LiveSource` polling transport + Join-as-Live spoiler veil + TV-sync delay slider | Plan §5; `watermark.ts` + growable packs + Query polling make it mostly composition |

---

## 4. Recommended execution order

```
PHASE A  (you, 15 min)  →  the single highest-value action in this document
     ↓
PHASE B  (one continuous effort — the remaining anatomy plan)
     ↓
PHASE C  (stack decision FIRST, then surfaces)
     ↓   C and D interleave once metrics exist — both consume the same engine
PHASE D  (SC specimen is blocked by B1)
     ↓
PHASE E  (rename early enough to inform copy; live last)
```

### Why this order

- **A before everything** because nothing has been seen running, and the anatomy shader is
  the least compiler-verifiable thing in the repo.
- **B is one chunk** because pit lane, garages, rake, callouts, and the iso kernel all touch
  `TracksideDressing.tsx`/`TrackFurniture.tsx`/the same infrastructure — splitting them
  across sessions means re-reading 867 lines each time.
- **C0 gates C1–C6**, so it must be decided, not deferred.
- **D1 needs B1** (the SC specimen's pit-exit path is pit-lane geometry).

---

## 5. Decisions only you can make

| Decision | Context | Blocks |
|---|---|---|
| **A2 — commit cadence** | 94 uncommitted paths. House rule #6 is owner-only. | *everything's recoverability* |
| **C0 — TanStack/Bklit, or stay dependency-free?** | Dossier/SeasonStandings/MeetingLore shipped without them. Real trade-off: house-style canvas charts = full control + zero deps, vs. Bklit's breadth in a day. | all of Phase C |
| **E1 — the name** | `PLAN.md` §7 recommends Pitboard. Name is everywhere in docs/UI/About. | final polish, copy |
| **Plan §3 open decision** — official turn numbers via livetiming `TrackInfo`? | gray-area source; until decided our T-numbers stay labelled data-derived (they are) | nothing hard |
| **Plan open question** — desaturate historical team colours or show as-is? | affects pit fasciae (B2/B3) | B2 only |

---

## 6. House rules (carry through every phase)

1. One pipeline, two consumers — never fork normalization (`normalizeResults` shared).
2. Every displayed number traces to `metricsFor()` or a named table — no vibes.
3. Enrichment sources never block core loads (jolpica/circuitMeta fail soft).
4. Porcelain law: hairlines not cards, ink hierarchy, ONE red voice, mono data.
5. Simulated entities must self-declare in X-ray lineage.
6. **Owner commits, AI never does.**
7. **Never lose a plan again** — plans go in `docs/plans/`, in git, referenced from `HANDOFF.md`.

---

## 7. Known risks

- **Everything is unverified visually.** A green `typecheck` proves nothing about pixels.
  The Task-1/4 *visual* gate from the anatomy plan is still open, and it is the real gate.
- **`widthGain` coupling is load-bearing.** Every new track-side element must ride it or it
  desyncs at macro zoom. B1–B4 all depend on this; verify zoom-out after each.
- **Anatomy geometry density vs frame rate** — 100+ parts × shadows. The shed ladder in
  `PostFX.tsx` is the safety net; if it engages early, cut screws to 12, single-arm wishbones.
- **Zero commits** — one bad edit away from losing months of work.
- **Doc drift is now the *documented* norm** — this roadmap exists to fix that. Update it as
  tasks land, or it becomes AUDIT.md #5.
