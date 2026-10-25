# APEX//OS — Anatomy Car + Miniature Race World

## Goal

Turn the porcelain diorama into an anatomy-grade miniature: a click-to-enter cutaway F1 car driven by live telemetry (the "Anatomy Car"), miniature race cars whose team color, brake glow, DRS, and tire state are all real telemetry rendered through the existing instanced shader, and a fully-dressed track environment (pit lane, pit boxes, garages, stands, gantry, marshal posts, trees) that stays anchored to the road via the existing `widthGain` channel.

## Current context / assumptions

- Repo: `D:\Fable`, branch `master`, zero commits. Do NOT commit unless asked (house rule #6). Typecheck gates everything: `npm run typecheck` must stay green (`tsc --noEmit`, strict, `noUnusedLocals`/`noUnusedParameters`).
- The 3D scene is React-three-fiber + three.js r0.185. Orthographic camera locked at 35.264° (`src/scene/CameraRig.tsx:26` `ISO_ELEV`). Post pipeline (`src/scene/PostFX.tsx`) owns tone mapping + adaptive shed ladder; `sceneRefs.quality.shed` (0–3) is the quality signal.
- `src/scene/carGeometry.ts` builds two car fidelities (LO ~300 tris, HI ~3k tris) merged via `mergeGeometries`, each vertex tagged with `aDark` zone (0=livery, 0.3=brake light, 0.55=cockpit, 0.85=rim, 1=rubber). `getCarGeometry(hi)`, `getPawnGeometry()` are cached singletons.
- `src/scene/Cars.tsx` instantiates 20 cars from telemetry every frame. Per-instance attributes: `aTeam` (vec3 team color), `aState` (vec4 brake, throttle, drs, focus), `aTire` (vec2 compoundId, ageFrac). The car shader already paints team color (spine stripe + flood via `uPiece`), brake-light emissive, DRS green flap, focus recede — ALL DATA-DRIVEN already. Wheel rotation is NOT implemented.
- `src/scene/sceneRefs.ts` — `widthGain: { value }` is the road-coupling channel: every road-relative surface (ribbon, skirt, wall, kerb, gantry, marshals, pit buildings, trees) rebuilds its xz from `aC + aN*(aBase + halfWidth*widthGain*aRoad)` in the vertex shader. ANY new track-side element MUST ride this channel or it will desync at macro zoom.
- `src/scene/trackBuilder.ts` — `TrackModel` gives: `points` (closed centerline, n*3, world coords), `n`, `cumDist`, `length`, `halfWidth` (6.5m), `sectorParam`, `corners` (each `{idx, param, dir, angle, number}`), `bounds`, `center`, `radius`, `paramOf(x,z,maxDist)`, `indexOfParam(p)`. World mapping: `world.x=tel.x`, `world.y=tel.z-elevationBase`, `world.z=-tel.y`.
- `src/scene/TracksideDressing.tsx` is the pattern to copy for buildings: `anchorPoint(model, idx, side, dist, absY, into)` returns a world point + heading off the centerline; `findStraights(model)` returns the longest gaps between corners; buildings are road-coupled `Block`s re-anchored each frame with `shift = (widthGain-1)*halfWidth`. It already builds a gantry, a grandstand, a low pit building, marshal posts, trees, kerbs, walls, skirt.
- `src/scene/Plinth.tsx` — `PLINTH_TOP_Y = -0.9` is the paper surface every building stands on (`PAPER_Y = PLINTH_TOP_Y + 0.05`).
- `src/engine/sampler.ts` — `sampleCar(ch, t, out)` fills a `CarSample` (x,y,z,heading,speed,throttle,brake,gear,rpm,drsOpen,valid). Reusable, zero-alloc. This is the single source of car state for anything live.
- State store: `src/state/appStore.ts` (`useAppStore`). Relevant reads: `session`, `raceIndex`, `focusDriver`, `density`, `cameraMode`. `setFocusDriver(n)` exists. Camera modes: `director | chase | turntable | orbit | top`.
- No test harness exists. Verification = `npm run typecheck` + `npm run build` + manual `npm run dev` screenshot review. `scripts/verify-pack.ts` truth-checks a pack's decode (not scene geometry).
- The skills (anatomy, iso-glow, hairline) are NOT installed as runtime deps and will NOT be added. This plan adopts their *craft method* (anatomy: the object is the explanation, many small solid parts, four tones by facing, one lit subject, true numbers; iso-glow: switched-on glows; hairline: pointer-reactive line figures, themed via CSS vars). They inform geometry + material design only.

### What "the three skills" mean for this build (one paragraph each)

- **Anatomy** → the cutaway car is an anatomy figure: 80–150 small solid parts (floor, tub, suspension arms, pushrods, brake ducts/discs/calipers, radiators, sidepods, engine cover, gearbox, floor edges, diffuser, wing elements, halo, helmet), four-tone shaded by facing under the existing key light, ONE lit subject at a time, and every readout number comes from the same `sampleCar` value that moves the part. Click a car → camera transitions into the cutaway in the SAME orthographic world and light rig.
- **Iso-glow** → the "switched on = glows" rule. In the cutaway, the part currently being exercised by telemetry glows (brake disc while braking, engine while on power, DRS flap when open, the lit wheel when that tire is hot). In the diorama, this is already half-true (brake light, DRS flap) — we extend it to a heat-soaked tire and a lit power-unit strip at conversational zoom.
- **Hairline** → the pointer-reactive line-figure craft, applied to the environment's annotation layer: corner callouts, sector gates, and the pit-box/garage labels are drawn as fine ink lines that brighten on hover. Themed off existing tokens (`--line`, `--text-lo`, `--accent`) — no new CSS system.

## Architecture / proposed approach

Three independent layers, each in its own module under `src/scene/`, each riding existing infrastructure so nothing forks:

1. **`AnatomyCar.tsx`** — a cutaway car, 80–150 merged solid parts, one `MeshStandardMaterial` patched with instanced-free per-part zone uniforms (it renders ONE car, not 20). Driven each frame by `sampleCar` on the focused driver's channels. A `useFrame` reads the same `CarSample` that feeds the diorama car and drives: brake disc emissive (brake channel), engine/combustion glow (throttle), DRS flap rotation (drsOpen), wheel rotation (speed/velocity), steering angle (heading delta), gear engagement (gear), tire compound color. Entry/exit is a camera `cameraMode` transition in `CameraRig` (`anatomy` mode) that pulls the ortho camera to the car and the AnatomyCar mounts. Reads `focusDriver` from the store; if null, shows the leader.
2. **`MiniCars.tsx`** (rework of the instanced layer inside `Cars.tsx`, not a new file — extend the existing `aState`/`aTire`/`aTeam` shader) — add: (a) wheel spin via a new per-instance `aSpin` (accumulated wheel angle from speed), (b) tire heat glow (brake history → heat, glows the sidewall when hot), (c) steering (front wheels yaw by heading rate), (d) power-unit light strip at close zoom. All through the existing patched `MeshStandardMaterial` + instanced attributes. NO new draw calls beyond the existing three meshes (lo/hi/pawn).
3. **`TrackWorld.tsx`** (new module; the environment builder, extracted from and extending `TracksideDressing.tsx`) — pit lane geometry (a parallel service road branching off the main straight into a pit box row), pit boxes (one per team, garage fascia, team-colored), garages (the long pit building with individual bays), main grandstand (seating rake + roof), a secondary stand, the start/finish gantry (already exists — reuse), marshal posts (exist), tree groves (exist), and hairline corner callouts (extend `TrackFurniture`). Every element is a road-coupled `Block` riding `widthGain` and anchored with `anchorPoint`. All built once per `model` in a `useMemo`, disposed on unmount.

`Theatre.tsx` wires all three: it already renders `<Cars>`, `<TracksideDressing>` (becomes `<TrackWorld>`), `<CameraRig>`. We add `<AnatomyCar>` conditionally when `cameraMode==='anatomy'`, and add the anatomy camera mode to `CameraRig`.

## Step-by-step tasks

> Conventions for every task: file paths are exact and relative to `D:\Fable`. After each task run `npm run typecheck` (expected: exit 0, no output) and `npm run build` (expected: `✓ built in ...`, exit 0). Screenshot-review via `npm run dev` → http://localhost:5199 after each visual task (the plan's "verify visually" steps). Commit is OPTIONAL and owner-only — do not commit unless the owner explicitly asks (house rule #6).

---

### Task 0 — Extend `sceneRefs` + store plumbing for the anatomy layer

**Goal:** a shared handle for the anatomy car's live sample and the new camera mode, so `AnatomyCar`, `CameraRig`, and the UI never prop-drill or duplicate sampling.

**File:** `src/scene/sceneRefs.ts`
**Action:** add two fields to `SceneRefs`:
```ts
  /** the live sample of the currently anatomy-focused car, written by
      AnatomyCar each frame, read by nothing else (kept for future HUD) */
  anatomySample: import('../engine/sampler').CarSample | null
  /** current camera mode mirrored for frame systems that need it without React */
  cameraMode: string
```
Set both in the `sceneRefs` initializer (`anatomySample: null`, `cameraMode: 'director'`).

**File:** `src/state/appStore.ts`
**Action:** add `cameraMode: 'anatomy'` to the camera-mode union type, and a setter `setCameraMode`. (Find the existing `cameraMode` state + its setter and extend the union — do not duplicate the field.)

**Verify:** `npm run typecheck` → exit 0.

---

### Task 1 — Wheel-spin + tire-heat in the miniature shader (the "real race car" layer)

**Goal:** miniature cars get spinning wheels (speed-driven), tire heat glow (brake-driven), and front-wheel steering — all through the existing instanced `MeshStandardMaterial`, no new meshes.

**File:** `src/scene/Cars.tsx`

1.1 Add a per-instance attribute `aSpin` (vec2: accumulated wheel angle, front-wheel steer) alongside `aState`/`aTire`. Add `aHeat` (float 0..1 tire heat) — OR fold heat into `aState` as a 5th component by widening `aState` to vec5. **Decision: widen `aState` to `vec5`** — fewer attribute slots, one `needsUpdate`. Update the `Float32Array(count * 4)` → `count * 5`, the stride math (`s = i*4` → `i*5`, `s+3` focus stays, `s+4` = heat), and every `setAttribute('aState', ...)`.

1.2 In the vertex shader `begin_vertex` block, rotate wheel vertices around their local axle by `aSpin.x`. Wheel vertices are identified by `aDark == 1` (rubber). Apply: if `step(0.9, aDark)` is true, rotate `position.xy` about origin by `aSpin.x` (wheels are cylinders on the X axis after `carGeometry` builds them — verify the axle axis by reading `WHEEL_POSITIONS` + the `rotateX(PI/2)` in `carGeometry.ts:147`; wheels spin about the local X). Steer: front wheels (`vLocal.x > 0`, i.e. the two at x=+1.55) additionally yaw by `aSpin.y`.

1.3 Accumulate spin each frame in the `useFrame` loop (the loop already iterates all cars and fills `stateAttr`): `spinAngle[i] += (sample.speed / 1000) * (wheelRadius / ) * dt` — wheel radius is `0.34` (from `carGeometry.ts:147` `CylinderGeometry(0.34,...)`). Spin angular velocity = `sample.velocity / 0.34` (m/s ÷ m = rad/s); integrate `spinAngle += ω * dt`. Steer angle = smoothed `(heading - prevHeading)/dt`, clamped to ±0.5 rad, applied only to front wheels. Persist `prevHeading` in a ref array.

1.4 Tire heat: maintain a per-car heat accumulator. Heat rises with brake (`+ sample.brake/100 * dt * k`) and cools otherwise (`- dt * k2`), clamped 0..1, then low-pass smoothed. Write to `aState.w` (heat). Threshold `> 0.7` = glowing tire.

1.5 Fragment shader: on wheel vertices (`step(0.9, vDark)`), add emissive tinted by compound color scaled by heat: `totalEmissiveRadiance += uCompound[int(vTire.x+0.5)] * vState.w * 1.2` when `vState.w > 0.6` (smoothstep in). This is the iso-glow rule: the switched-on (hot) tire glows, cold tires stay ink.

**Verify:** `npm run typecheck` → exit 0. `npm run build` → exit 0. Visual: dev server, any race session, pause at speed — wheels of moving cars should visibly rotate; hard-braking zones (the ember corners on the ribbon) should make the braking car's tires glow warm.

---

### Task 2 — Power-unit light strip + DRS confirmation at conversational zoom

**Goal:** at ENGINEER zoom (`density>0 && span<460`, the existing hi-fidelity condition), the engine cover glows on throttle and the DRS flap visibly opens.

**File:** `src/scene/Cars.tsx` (same shader, additive)

2.1 Engine cover zone: the engine-cover/spine geometry sits around `vLocal.y in [0.4, 0.75]`, `vLocal.x in [-1.5, 0.5]` (from `carGeometry.ts` spine at y≈0.58, airbox y≈0.72). Add emissive on that zone scaled by `vState.y` (throttle): `totalEmissiveRadiance += uDrsLight * 0.0 + vec3(0.9,0.45,0.1) * vState.y * 0.35` — a warm amber core while on power. Keep subtle (porcelain law: glow reserved).

2.2 DRS flap: the rear-wing flap geometry is `vLocal.x in [-2.4, -2.2]`, `vLocal.y > 0.9`. When `vState.z` (drs) is 1, rotate those vertices up by ~0.12 rad in the vertex shader (hinge at the leading edge) AND keep the existing green tint. This makes DRS a physical open, not just a recolor.

**Verify:** typecheck + build. Visual: find a DRS zone on a straight (watch the DNA strip for a straight), confirm the flap lifts and the engine cover warms under throttle.

---

### Task 3 — Build the Anatomy Car geometry (the flagship)

**Goal:** `src/scene/anatomyCar.ts` — a function `getAnatomyCarGeometry(): THREE.BufferGeometry` that returns ONE merged, ~100-part cutaway car in the same world scale and `aDark`-zone convention as `carGeometry.ts` so the SAME instanced-style shader zone logic can be reused (but rendered as a single non-instanced mesh).

**File:** `src/scene/anatomyCar.ts` (new)

3.1 Copy the `withDark(geo, dark)` helper pattern from `carGeometry.ts:20`. Same zones: `0` livery/structure, `0.3` brake disc, `0.55` cockpit/carbon, `0.85` alloy rim, `1` rubber. ADD two new zones: `0.15` = power-unit/engine (glows on throttle), `0.7` = radiator/core (glows when hot). Document them in the header comment.

3.2 Build parts with three.js primitives + `mergeGeometries` (all `BufferGeometry`, then `mergeGeometries(parts, false)`), each pushed through `withDark`. Real-world scale in meters (match `carGeometry`: car ~5.6m long, ~2m wide). Parts list (aim 80–120 solids; group by assembly so it reads as a machine):
   - **Base/tub:** flat floor pan (box), survival cell tub (extruded shape, like `bodyShape` but higher-sided), nose cone (tapered cylinder).
   - **Suspension (×4 corners):** upper wishbone (two thin boxes per corner), lower wishbone, pushrod, trackrod — 4 corners × ~4 arms = 16 parts.
   - **Brakes (×4):** brake disc (cylinder, dark=0.3), caliper (small box, dark=0.3), duct (curved box, dark=0.55). 12 parts.
   - **Wheels (×4):** tire (cylinder r=0.34, dark=1), rim (r=0.21, dark=0.85). 8 parts.
   - **Power unit:** engine block (box, dark=0.15), turbo/mguk-housing (cylinder), exhaust (small cylinder). 3 parts.
   - **Cooling (×2 sidepods):** radiator core (box, dark=0.7), inlet. 4 parts.
   - **Aero:** front wing main + flap + 2 endplates, rear wing main + DRS flap + 2 endplates + swan necks, floor edges (×2), diffuser. ~12 parts.
   - **Cockpit:** halo (torus), steering wheel (small torus), seat, helmet (sphere, dark=0). ~4 parts.
   - **Detail screws/bolts:** a scattering of 20–30 tiny cylinders at assembly joints (dark=0.55) — this is what makes it read as anatomy, per the skill. Use `mulberry32` seeded RNG for determinism.

3.3 `getAnatomyCarGeometry()` caches in a module-level `let cachedAnatomy` and `computeBoundingSphere()`. Same dispose discipline as `carGeometry` (the owning component disposes).

3.4 Export a `ANATOMY_ZONES` const documenting the zone numbers so `AnatomyCar.tsx` and any future shader share one source of truth.

**Verify:** `npm run typecheck` → exit 0 (new file, no consumers yet — it must still compile standalone). Add a throwaway check: temporarily `console.log(getAnatomyCarGeometry().getAttribute('aDark').count)` — actually NO console.logs; instead verify via build and the Task 4 visual. For now: typecheck + build green.

---

### Task 4 — The AnatomyCar component (live, telemetry-driven cutaway)

**Goal:** `src/scene/AnatomyCar.tsx` — renders the cutaway car for the focused driver, driven by `sampleCar`, with the camera transition. Click-to-enter from the diorama.

**File:** `src/scene/AnatomyCar.tsx` (new)

4.1 Component reads `useAppStore` for `session`, `focusDriver`, `raceIndex`, `cameraMode`. Target driver = `focusDriver ?? raceIndex?.leaderAt(raceClock.t) ?? null`. If null, render nothing.

4.2 On mount, build the material ONCE (module cache or `useMemo` keyed on nothing): a `MeshStandardMaterial` (roughness 0.5, metalness 0.15) patched via `onBeforeCompile` with the SAME uniform set as `Cars.tsx` (`uPorcelain, uCockpit, uTireDark, uRecede, uBrakeLight, uDrsLight, uCompound[6]`) — copy the fragment zone logic from `Cars.tsx:170-197`, EXTENDED with:
   - power-unit zone (`step(0.1,vDark)*(1-step(0.2,vDark))`): emissive amber × throttle.
   - radiator zone (`step(0.65,vDark)*(1-step(0.75,vDark))`): emissive warm × a smoothed heat uniform (brake history, same accumulator as Task 1.4 but car-global).
   These are NOT instanced (single car), so instead of `aState` attribute, pass a `uLive` uniform `vec4(brake, throttle, drs, heat)` updated each frame from `sampleCar`. Wheel spin: a single car can use per-mesh rotation groups instead of a shader — create 4 wheel sub-`<group>` refs and rotate them in `useFrame` by the integrated angle. DRS flap: a sub-group rotated by drs. This is simpler and correct for one car.

4.3 `useFrame`: `sampleCar(session.channels[driver], raceClock.t, sample)`. If `!sample.valid`, hide the mesh. Else set position `(sample.x, sample.z - model.elevationBase, -sample.y)`, rotation.y = `sample.heading`, and drive: brake-disc material emissive (via a dedicated `MeshStandardMaterial` on the disc group, `emissive.setRGB(...)` × brake), wheel group rotations (integrate `sample.velocity/0.34 * dt`), DRS flap group rotation (0 → 0.12 rad on drsOpen), throttle → engine-cover emissive, heat → radiator emissive. Write `sample` to `sceneRefs.anatomySample`.

4.4 Because the car is at track scale (~5.6m) and the anatomy view should fill the frame, the anatomy camera mode (Task 5) sets a tight span (~14m). The car mesh uses the SAME position the diorama car has, so entering anatomy mode is a pure camera move + material swap, no geometry teleport.

4.5 Wire into `Theatre.tsx`: `{cameraMode === 'anatomy' && <AnatomyCar model={model} />}`. Also hide the diorama `<Cars>` field's focused-car highlight is fine to leave; the anatomy car sits on top.

4.6 Entry affordance: in `Cars.tsx` the full-tag sprites already respond to clicks? (check — if tags are clickable and call `setFocusDriver`, ADD a second action: double-click a car → `setCameraMode('anatomy')`). If tags aren't clickable, add an `onDoubleClick` on the tag sprite that calls `setFocusDriver(driverNumber); setCameraMode('anatomy')`. Escape or clicking empty space (`onPointerMissed` already calls `setFocusDriver(null)`) returns to the previous mode — store the pre-anatomy mode in the store to restore it.

**Verify:** typecheck + build. Visual: dev → a race → double-click a car → camera cuts to the cutaway → play → confirm: wheels spin with speed, brake discs glow under braking, DRS flap opens on straights, engine warms on throttle, tires glow when hot. Press Escape → returns to director.

---

### Task 5 — Anatomy camera mode in CameraRig

**Goal:** add `'anatomy'` to the camera-mode switch so the rig frames the focused car tightly.

**File:** `src/scene/CameraRig.tsx`

5.1 In the `useFrame` mode branch (currently `director | chase | else plan/top`), add an `anatomy` branch BEFORE the director logic: target = focused car position (reuse the `carPos` helper already in the file), `spanGoal = 16` (meters — fills frame with a 5.6m car plus margin), azimuth = the car's heading + a fixed 3/4 offset so you see the cutaway's open side. Smooth-pan to it (no hard cut, or a short cut on entry). Keep elevation locked at `ISO_ELEV`.

5.2 On entering `anatomy`, record the previous mode in the store (Task 4.6) so Escape restores it. The `lastMode` ref pattern already exists for orbit handoff — extend it.

**Verify:** typecheck + build + the Task 4 visual (the camera move is part of the anatomy entry).

---

### Task 6 — Extract the environment into TrackWorld + pit lane geometry [COMPLETED]

**Goal:** `src/scene/TrackWorld.tsx` — owns all track-side solids. Pit lane as real geometry (a parallel service road + box row), so pit stops have a place to happen.

**File:** `src/scene/TrackWorld.tsx` (new), sourced from `TracksideDressing.tsx`

6.1 Move the entire `TracksideDressing` implementation into `TrackWorld.tsx` (keep `TracksideDressing.tsx` as a re-export shim `export { TrackWorld as TracksideDressing }` for one release, OR update `Theatre.tsx` import directly — prefer updating `Theatre.tsx` and deleting the shim to avoid two names). Keep ALL existing exports/behavior identical (skirt, wall, kerb, gantry, marshals, trees, rain, grandstand, low pit building).

6.2 ADD the pit lane: a service road that runs parallel to the main straight, offset outward by `halfWidth + 10.5m` (the existing low "pit building" sits there — replace that single box with the real pit complex). Build the pit lane as a gain-coupled ribbon strip (reuse `skirtGeometry`-style but narrower, ~8m wide, darker asphalt) spanning the main-straight `findStraights()[0]` run, with a pit-entry and pit-exit chicane (two short connector strips) at each end. Each strip is a road-coupled mesh riding `widthGain` (copy the `GAIN_VERT`/`GAIN_APPLY` snippet + attribute builder from `TracksideDressing.tsx:78-86`).

6.3 ADD pit boxes: one box per team (20 → cap at the field size, or 12 for cleanliness), evenly spaced along the pit lane, each a garage bay: floor slab + back wall + team-colored fascia (team color from `session.drivers` team mapping — read once in `useMemo`). Each box is a road-coupled `Block` (re-anchored each frame with the existing `shift` pattern). The fascia color is the ONE place team color appears as architecture (iso-glow: the switched-on garage glows its team color when that team's car is pitting — Task 6.4).

6.4 Live pit-box state: `raceIndex` + `raceClock.t` → which driver is in the box (a pit event within ±pitDuration/2 of `t`). That box's fascia gets `emissive` team color; others stay porcelain ink. Reuse the marshal-flag live-material pattern (`TracksideDressing.tsx:744-762`): keep a small array of fascia materials, update in `useFrame` from `useAppStore.getState().raceIndex` + `session.pits`.

**Verify:** typecheck + build. Visual: a race with pit stops — the pit lane reads as a real service road, boxes line it, and during a stop the pitting car's garage glows its team color.

---

### Task 7 — Grandstand rake + secondary stand + hairline callouts [COMPLETED]

**Goal:** the main grandstand reads as a grandstand (tiered seating, not a box), and corner/sector/pit labels become hairline pointer-reactive annotations.

**File:** `src/scene/TrackWorld.tsx` (extend Task 6)

7.1 Replace the main-straight building box with a tiered grandstand: 4–5 stacked seating rows (thin boxes, each set back + up from the last, like a rake), a roof slab on posts, a dark seating band. Keep it a road-coupled `Block` group (re-anchored with `shift`). Secondary stand on `findStraights()[1]` gets the same treatment at smaller scale.

7.2 Hairline callouts (`src/scene/TrackFurniture.tsx` — extend, not replace): the existing corner-number chips and sector chips are canvas sprites. ADD a hairline layer: a thin line sprite from each corner chip to the corner apex, and a leader line + small dot at the start/finish and each sector gate. These brighten (`--line` → `--text-mid`) when the pointer is within N px of their screen position (project world→screen each frame, compare to a stored pointer position from a window `pointermove` listener). Themed off existing CSS tokens via `chipTexture` color params — no new CSS vars.

**Verify:** typecheck + build. Visual: grandstand has visible rake/steps; corner callouts draw fine leader lines that brighten on hover.

---

### Task 8 — Polish pass + docs + memory [COMPLETED]

**Goal:** verify the whole system composes, update the design docs, record the new architecture.

8.1 Full `npm run typecheck` + `npm run build`. Both must be green.

8.2 Run `npx tsx scripts/verify-pack.ts 9636` (expected: decodes the hero pack, prints track/corners/classification — confirms the data layer is untouched).

8.3 Update `HANDOFF.md` §6 file map: add `src/scene/anatomyCar.ts`, `src/scene/AnatomyCar.tsx`, `src/scene/TrackWorld.tsx`, the new camera mode, the `aState` vec5 change. Update `README.md` roadmap if the anatomy car is a headline.

8.4 Record in memory: the anatomy-car zone convention (`0.15` power unit, `0.7` radiator) and the rule that every new track-side element MUST ride `sceneRefs.widthGain`.

**Verify:** typecheck + build green; `verify-pack.ts` prints without error.

## Tests / validation

There is no test harness (confirmed: no test files, no test script in `package.json`). Validation is therefore:

- **Per task:** `npm run typecheck` (exit 0, empty output) and `npm run build` (exit 0, `✓ built in ...`). These are the gates — strict TS with `noUnusedLocals`/`noUnusedParameters` will catch dead code and forgotten disposals' types.
- **Per visual task:** `npm run dev` → http://localhost:5199 → load the hero pack (9636, São Paulo — it has rain, pit stops, battles, DRS, so it exercises every system) → the specific "Visual:" check listed in each task. Screenshot with the browser tool if a regression is suspected.
- **Data integrity:** `npx tsx scripts/verify-pack.ts 9636` after Task 8 — must decode and print the known Interlagos facts (15 corners, ~4.3 km, classification) with no error, proving the data path is untouched.
- **Performance sanity:** with the anatomy car mounted and 20 miniature cars + full environment, the frame rate should hold (the `PerformanceMonitor`/shed ladder in `PostFX.tsx` will engage if not — if it drops to shed rung 2–3 immediately, the anatomy geometry is too dense; reduce part count toward 80).

If `npm run typecheck` fails on a task, fix it before moving on — do not accumulate type errors across tasks.

## Risks, tradeoffs, and open questions

- **Risk: anatomy geometry density vs. frame rate.** 100+ solid parts × shadow casting is heavy. Mitigation: the anatomy car renders ALONE (diorama cars can stay visible but the cutaway is the subject); disable `castShadow` on the smallest detail screws; lean on the existing shed ladder. If it still tanks, cut the screw scattering to 12 and the wishbone detail to single-arm.
- **Risk: the `aState` vec4→vec5 widening (Task 1) touches a hot path.** The attribute stride change is mechanical but every `s = i*4` site must become `i*5`. Grep `stateAttr` + `s + 3` before and after. Typecheck will catch type errors but NOT a stride miss that happens to still typecheck (Float32Array indexing) — so the Task 1 visual (wheels spin, tires glow) is the real gate; also confirm the focus-recede still works (it reads `aState.w` → now must read the right component).
- **Tradeoff: single cutaway car vs. instanced.** The anatomy car is deliberately NOT instanced (one car, rich per-part animation via sub-groups). This is correct for the use case (you inspect one car) and keeps the shader simple. The diorama cars stay instanced and get the cheaper shader-driven spin/heat.
- **Tradeoff: pit lane as geometry vs. decor.** Real pit-lane geometry (Task 6.2) is more work than a painted strip but is what makes "watch the pit stop as a machine" possible later, and it rides the existing `widthGain`/`anchorPoint` machinery for free. Chosen: real geometry.
- **Open question (owner):** team-color fidelity. `session.drivers[].team_colour` is a 6-hex string; the fascia and existing car stripe already use it. For 2024+ seasons the colors are accurate. For older sessions they may be off — do we desaturate historical team colors, or show them as-is? Default: as-is (honesty — the data says what it says). Owner can override.
- **Open question (owner):** anatomy entry gesture. Planned: double-click a car tag → anatomy mode; Escape → back. Alternatives: a key (`F` for "focus/anatomy") or a button on the FocusPanel. Double-click is proposed because tags are already the per-car affordance. Owner picks before Task 4.6 is finalized.
- **Not in this plan (deferred, noted for later):** the causal-chain lit path (brake→deceleration→gap→overtake) through the anatomy car, night/blueprint register, the pipeline-as-a-machine About figure, hairline UI empty states. These are the next layers after this world exists.

---

# RESEARCH UPGRADE (2026-10-14) — findings folded into the plan

## Sources reviewed (deep reads, not just landing pages)

- **anatomy SKILL.md (full)** — pulled from `github.com/wheresryan22/anatomy`. The craft rules, the kit API, the audit discipline. Key rules adopted below.
- **iso-figure SKILL.md (full)** — pulled from `github.com/MrBongoC/ai-iso-skill`. The SVG `plane()` projection kernel (the 15-line isometric projector), the "parts you can press that produce real output" rule, the painter's-order rules, the four-corner plate frame (`Fig N` / name / hint / live readout).
- **iso-glow demos** — the 3D turntable (orbit/revolve, `I` iso-view, `L` lights, engine/cabin toggles) and the office tower (click a floor → its lights switch; a live "16/24 floors lit" readout). Both inform the anatomy car's interaction model.
- **anatomy community gallery** — 44 figures, incl. **BMW iX3 on the bench** (~3 h, full car at anatomy fidelity) and a **floating-caliper disc brake** and a **Ford DPS6 twin clutch** (1 h 20 min). Proof the car and the brake/gearbox subsystems are achievable at this fidelity in this time budget. The gallery also models a quality loop we adopt: build → screenshot at 1× and 4× → "read every PNG" → fix → repeat.
- **F1 project landscape** — `f1-dash` (Next.js live dashboard: leaderboard, tires, gaps, laps, mini-sectors), `undercut-f1` (TUI live timing with variable delay + session replay + radio transcription), `MultiViewer for F1` (synced live timing + mini-sectors + speeds), `IAmTomShaw/f1-race-replay` (6.8k★, Python/Arcade replay with simulated safety car, leaderboard, tyre compounds, per-driver telemetry insights), `f1-replay` (PyPI, 2D map + strategy overlays + circuit posters colored by speed/brake/elevation), `F1ReplayTiming`, `open-pit-wall`, `pitwall`, `slipstream`. These define the feature-parity bar for a "full end-to-end system."
- **OpenF1 API (docs)** — confirmed the full endpoint list. Two endpoints NOT currently ingested that the ecosystem uses: **`/overtakes`** (on-track passes: `overtaking_driver_number`, `overtaken_driver_number`, `position`, `date` — races only, may be incomplete) and **`/starting_grid`** (grid slots + qualifying lap; published post-quali, reflects penalties).

## Improvement ideas adopted from the research (new/changed tasks)

1. **[NEW Task 1.6] Data layer: ingest `/overtakes` + `/starting_grid`.** The Moments Engine currently *infers* overtakes from the position change-log. The `/overtakes` endpoint is the authoritative on-track-pass source (f1-dash/f1-replay both use it). Add both to `sessionLoader.ts`, the pack codec (`pack.ts` v5 — bump `PACK_VERSION`, keep v3/v4 decode), and `types.ts`. Overtakes become a new `MomentType` source cross-checked against the inferred ones (honesty rule: label inferred vs. official). Grid powers a "grid → finish" position-gain readout in the Dossier/standings.
2. **[NEW Task 3.0] Adopt the anatomy "truth-first" model module.** Before any anatomy geometry, write `src/scene/anatomyModel.ts` — a pure module holding the real F1 car numbers (2024 regs: wheelbase 3.6 m, width 2.0 m, wheel dia 0.72 m front/0.72 rear with 18" rims, brake disc 0.34 m, mass 798 kg, etc.) and the telemetry→part mapping. Every part's size, every shader threshold, and every readout number reads from this one module, so none can disagree (anatomy rule: "every number the figure shows comes from the same model that moves its parts").
3. **[UPGRADED Task 4] The anatomy car as an interactive machine (iso-figure rule).** The cutaway isn't a thing you only watch — parts are pressable and produce real output: click the brake disc → the readout shows live brake temp/pressure derived from the brake channel; click the DRS flap → it toggles and the readout shows DRS state + detection-zone status; click a wheel → compound + age + temperature. This is the iso-figure "decide what pressing a part produces" rule applied to telemetry. The plate-frame corners (`Fig N` / car name / hint / live readout) become the anatomy overlay's HUD.
4. **[UPGRADED Task 5] Camera: adopt iso-glow's turntable orbit + the anatomy cutaway camera.** In anatomy mode the camera gets (a) the existing 3/4 iso framing, plus (b) an auto-revolve like iso-glow's `⟳` (slow orbit, pauses on interaction, resumes on idle), plus (c) `L` to toggle the light rig between the gallery key and a "workshop" raking light that makes the cutaway's internal parts read. The office-tower lesson: one click changes state of one sub-part and updates a live count/readout — the anatomy car's per-part clicks do the same.
4. **[NEW Task 7.3] Hairline callouts via the SVG-plane kernel.** The iso-figure `plane()` kernel (a 15-line `matrix()` projector: `C=cos30, S=sin30; P=(x,y,z)=>[(x-y)C+OX,(x+y)S−z+OY]`) lets us draw 2D SVG text/lines/paths that sit exactly on the isometric ground/wall planes. Use it for the annotation layer that currently uses canvas sprites (corner numbers, sector gates, pit-box labels, dimension lines in anatomy mode): sharper at every zoom, hairline-crisp, and trivially themed with CSS vars. Implement as a small `src/scene/isoPlane.ts` exporting the kernel + a `<IsoLabel>` that projects a world point to screen and renders an SVG overlay (a full-viewport `<svg>` with `pointer-events:none`, drawn in `useFrame` or on demand).
5. **[NEW Task 8.5] The anatomy "second look" quality loop (from the skill's verify step).** After the anatomy car is built: screenshot at 1× and 4× (browser tool), "read every PNG," and fix what's bare — the skill is explicit that a part can be right in every number and still look wrong, and that most quality lives in the second look. Budget one review-fix round per major visual task. This is now an explicit step, not an afterthought.
6. **[DEFERRED, documented] Full end-to-end parity items** the F1 ecosystem has that we don't, noted for after this world lands: live-session polling transport (`LiveSource` seam exists), variable TV-sync delay (undercut-f1), team-radio transcription (undercut-f1 uses it; we already play radio), mini-sector overlays (f1-dash/MultiViewer), strategy counterfactual sandbox, championship standings across seasons (jolpica already wired). These are NOT in the build order below — they're the roadmap this plan unblocks.

## What did NOT change and why

- The three-layer architecture (AnatomyCar / miniature rework / TrackWorld) stands — the research confirmed it rather than redirecting it.
- The `widthGain` road-coupling rule is non-negotiable and unchanged; every F1 project that looks right at macro zoom does the equivalent.
- The porcelain law (glow reserved, one red voice) stands. iso-glow's "switched-on glows" is compatible BECAUSE glow stays reserved to the switched-on part — it's a discipline, not a saturation.
- No new runtime dependency is added. The skills' *methods* are adopted (anatomy's craft rules, iso-figure's plane kernel), not their packages.
