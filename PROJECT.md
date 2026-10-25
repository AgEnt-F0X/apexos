# APEX//OS — project documentation

This is the long-form record of the project: where the idea came from, the decisions made
along the way and why, what was actually built, the problems solved during the build, and
where it can go from here. The [README](README.md) is the quick-start; this is the memory.

---

## 1. The origin

The brief, in the user's own words: an ambitious portfolio piece for a UI/UX and digital
product designer — a way to explore "insane amounts of data" and present it beautifully in a
way it hasn't been explored before. F1 was chosen as the data source because of the sheer
volume and richness available through free, unauthenticated APIs:

- **OpenF1** — live timing, telemetry, and on-track events; free for historical data from 2023
  onward, no API key required.
- **Jolpica-F1** — the open-source Ergast successor, full historical results back to 1950.
- **FastF1 / LiveF1** — Python wrappers for data-science and real-time work.

The user had already scanned the OpenF1 community's own show-and-tell gallery (~23 projects:
Pitbrain, F1 Replay, f1data.live, F1 Pitwall, Race Control, 3D F1 Data Visualization, and so
on) and correctly diagnosed the gap: **almost everything in that space is a flat timing
dashboard, a dot-on-a-map replay, or a stats site.** A 3D replay alone would not be novel —
several exist already, in cruder form.

### The three concepts on the table

Before landing on a direction, three concept pitches were floated:

1. **The F1 Spatial Ghost Engine** — a 3D qualifying-lap duel: two drivers' ghosts racing
   across a neon WebGL track built from real X/Y/Z telemetry, with a floating 3D HUD that
   reacts to braking, DRS, and sector deltas in real time.
2. **The Pit-Wall Command Center** — a real-time, high-density dashboard mimicking an F1 team
   principal's pit wall: anomaly detection (tire degradation spikes), a live "Pit Window
   Optimizer" widget, dense information architecture built to manage cognitive load.
3. **The Historic "Butterfly Effect" Strategy Simulator** — a what-if sandbox: pick a chaotic
   historical race, drag a driver's pit stop earlier on a timeline, and watch a
   physics/probability engine recalculate how the field would have cascaded.

A fourth, more fully-formed pitch — **ApexOS, the F1 Strategy & Spatial Command Engine** —
synthesized pieces of all three into a single vision: a dark tactical interface with a central
3D "Tactical Theatre" (neon-wireframe track, cars as kinetic wedges with brake-light vectors
and throttle particle trails), a left-panel "Predictive Ghost Pipeline" projecting pit-stop
outcomes spatially onto the track, and a right-panel floating glassmorphic HUD per car.

The user's explicit ask, verbatim: *"honestly there can be many things to extract from these
concepts to build something ultimate, something one time never ever seen or will be seen
again ever … given the amount of context I have to you, you can do something crazy."* And,
importantly: the project should also teach — "apart from racing what goes behind all what the
data engineer and the whole team sees, 'the pit wall.'" Data visualization as an information-
design practice, not just a racing toy.

---

## 2. The decisions that shaped v1

These were resolved through direct back-and-forth before any code was written, and they are
load-bearing — they explain *why* the architecture looks the way it does.

| Decision | Resolution | Why |
|---|---|---|
| **Which concept ships first?** | 3D Race Replay Theatre. Quali Ghost Duel dropped entirely. Pit-Wall Command Center is the *next* mode after v1, not part of it. | The user wanted the centerpiece to be the most ambitious spatial idea; a 2-car qualifying duel was too narrow in scope for the flagship piece. |
| **Live vs. replay?** | Replay-only v1, but the architecture is live-ready from day one (`SessionSource` interface, a `RaceClock` that owns "now"). | Building live support now would only be testable during actual race weekends and would compete with polish time. But the user wanted the *option* preserved, not bolted on later — hence the seam being designed in from the start. |
| **How much should the interface "teach"?** | A **dual-mode UI** was the initial framing (Broadcast vs. Engineer); this was pushed further mid-build into the **Density Dial** — a three-state semantic zoom (CINEMA / BROADCAST / ENGINEER) — because a binary toggle undersold the "teach data visualization as a practice" goal. | Directly answers the "what goes behind what the data engineer sees" ask — the dial *is* the information-design thesis made interactive. |
| **Hardcoded hero race or fully on-demand?** | The user explicitly pushed back on a "pre-baked" dataset: *"why does it need to be pre-baked? why can't it be on-demand?"* Resolved: the system is **fully on-demand** — any session from 2023 onward loads live from the OpenF1 API through the same pipeline. A "hero" pack for 2024 São Paulo GP exists only as a **pre-warmed cache of that same pipeline's output**, not a separate or special-cased dataset. | Preserves the "explore insane amounts of data" promise — nothing is faked or limited to one race — while still giving a portfolio visitor a sub-5-second first impression instead of a 1–2 minute cold fetch. |
| **"Go more creative, don't stop at what I said."** | This is why the build doesn't stop at "3D replay + dashboard." It produced the **five signature patterns** below, which go beyond anything requested literally and were framed explicitly as arguing for a *2027-standard* interaction model, not a 2026 one. | Direct response to the user pushing on differentiation: "what is the unique point in this? how are we making state-of-the-art UI for not 2026 standard but literally 2027 standard?" |

### The reframed thesis

Somewhere in the design pass, the guiding sentence became:

> *Existing projects display data. APEX//OS interprets the race, then choreographs your
> attention around that interpretation — at whatever information depth you ask for.*

Everything downstream — the Moments Engine, the Director, the Density Dial, X-ray mode — exists
in service of that one sentence.

---

## 3. The five signature patterns (the actual differentiation)

These are the patterns that make the case for "2027, not 2026." Each is described with what it
does and where it lives in the code.

1. **Diegetic telemetry** — data lives *in the world*, not in side panels (the game-design
   principle of putting the health bar on the character, applied to real F1 data for what is,
   as far as this research went, the first time in this space).
   - The track ribbon is a GPU shader that paints braking intensity, sector-yellow pulses, and
     wetness directly onto the asphalt (`src/scene/TrackRibbon.tsx`, `src/scene/trackBuilder.ts`).
   - Battles are physical: a taut light-bridge stretches between cars running within ~1.5s,
     its color shifting from ice to red as the gap tightens (`src/scene/BattleBridges.tsx`).
   - Tire compound and stint age are rendered as a material state on the car's wheels, not a
     number in a table (`src/scene/Cars.tsx`).
   - Brake lights, DRS-open glow, and throttle state are all driven directly by live channels.

2. **The Density Dial** — semantic zoom instead of a mode toggle. One continuous surface
   recomposes across three anchors: CINEMA (near-zero chrome, director cameras, subtitles only),
   BROADCAST (clean HUD, plain-language story), ENGINEER (full timing tower, telemetry strips,
   race-control log). Nothing switches views; components morph (`src/ui/DensityDial.tsx`,
   composition logic in `src/ui/Shell.tsx`).

3. **Temporal lensing** — the Moments Engine (`src/engine/moments.ts`) scores a "drama density"
   curve across the entire race from overtakes, battles, pit stops, flags, and weather changes.
   Directed playback compresses cruise laps up to 32× and slows toward real time exactly at the
   action. The Race DNA Strip (`src/ui/DnaStrip.tsx`) turns the scrubber itself into a
   visualization of the race's shape — position threads as a bump chart, safety-car/red-flag
   bands, a rain texture, pit notches, radio pins — and releasing a scrub near a story beat lets
   the playhead settle onto it ("moment gravity").

4. **X-ray mode** — hold `X` and the entire interface annotates itself in place: every visible
   element grows a plain-language explanation *and* its data lineage ("this gap = these two
   timestamp streams, subtracted"). Directly answers the "teach people what the pit wall sees"
   goal, built as an interaction pattern rather than static tooltips
   (`src/ui/XrayLayer.tsx`).

5. **The Director** — broadcast camera grammar encoded as a system
   (`src/scene/CameraRig.tsx`), driven by the Moments Engine: cuts on action, holds through a
   pass, goes wide when the field spreads out, tight chase when a gap enters DRS range,
   trackside tripod on pit stops. One keypress hands control to the user (orbit / chase /
   tactical top-down). Paired with **Join as Live**: enter any historical race as if it were
   happening now — the future is genuinely locked (no scrub-ahead, the DNA strip only draws
   the past, the leaderboard shows no destiny). This is both a novel product idea (spoiler-free
   re-watching of old races) and the proof that the live-ready architecture actually works: the
   whole UI runs off a clock it cannot fast-forward.

---

## 4. What was actually built

### Architecture

```
OpenF1 API
  └─▶ rate-limited, windowed fetch (web worker)      src/data/openf1.ts, sessionLoader.ts
  └─▶ uniform 5 Hz resample of motion channels        src/data/resample.ts
  └─▶ APEXPACK binary format (one artifact)            src/data/pack.ts
  └─▶ IndexedDB cache (instant revisits)                src/data/cache.ts
  └─▶ SessionSource seam (replay today, live later)     src/data/source.ts
       └─▶ RaceStateIndex (positions/gaps/stints)        src/engine/raceState.ts
       └─▶ FlagTimeline (SC/VSC/red/yellow spans)        src/engine/flags.ts
       └─▶ MomentsEngine (overtakes/battles/drama)       src/engine/moments.ts
       └─▶ RaceClock (the one owner of "now")            src/engine/RaceClock.ts
            └─▶ the 3D Theatre                            src/scene/*
            └─▶ the UI shell                               src/ui/*
```

- **Data layer.** A polite, queue-based OpenF1 client (2 concurrent lanes, shared cooldown on
  429/5xx) fetches session metadata, drivers, laps, stints, pit stops, race control messages,
  weather, team radio, and — the bulk of the volume — windowed positional (`location`) and car
  (`car_data`) telemetry for every driver. Everything is resampled onto a uniform 5 Hz grid and
  packed into a compact binary container (`APEXPACK`): one `ArrayBuffer` with a JSON header
  (metadata + small event tables) and typed-array blobs for the big columns. This exact format
  is what's cached in IndexedDB *and* what a pre-warmed hero pack on disk is — one pipeline, one
  artifact, no special-casing.
- **The 3D theatre.** The circuit is not a model file — it's *extruded from the data itself*.
  The fastest clean lap's positional trace is smoothed, resampled to a closed
  arc-length-parametrized centerline, and turned into a ribbon mesh carrying per-vertex
  attributes (braking heat, sector index) that a custom GLSL shader reads every frame. Twenty
  cars are drawn as a single instanced mesh, positioned by Catmull-Rom interpolation through the
  5 Hz channels, with a custom shader driving brake lights, DRS glow, and tire-wear material
  state from live per-instance attributes.
- **Race intelligence.** A `RaceStateIndex` answers "who's where, what's their gap, what tire
  are they on" at any timestamp via binary search over sparse change-logs. A `FlagTimeline`
  turns race-control messages into a flag-phase state machine (including sector-scoped
  yellows). The `MomentsEngine` derives overtakes, sustained battles, fastest laps,
     safety-car/red-flag periods, and rain transitions, and produces the drama-density curve that
     drives temporal lensing.
- **UI shell.** Status bar with live flag banner and weather, a timing tower whose rows
  physically glide when positions change, the Race DNA Strip, a driver-focus HUD with rolling
  canvas telemetry strips (speed/throttle/brake), a story feed that narrates in either
  plain-language (BROADCAST) or terse machine-log (ENGINEER) form, the Density Dial, and the
  X-ray annotation layer — all composed through one `Shell.tsx` governed by the density state.
- **Show-time features.** The Director's camera grammar, Join-as-Live, a first-run onboarding
  briefing (shown once, dismissible), and an in-app "About / process" overlay that documents
  the pipeline and the five patterns for anyone visiting the deployed portfolio piece.

### The PORCELAIN visual pass (September 2026)

A design audit concluded the concept was right but the render rig was under-executing it: the whole
world was flat-unlit, every surface a solid fill, every shadow a hand-painted blob. The pass kept
the ink-on-porcelain grammar and re-foundamented the rendering:

- **Light.** `shadows="soft"` with a real casting key light framed to the circuit's bounds; `flat`
  replaced by Neutral tone mapping; a small offline `RoomEnvironment` PMREM for lacquer sheen; a CSS
  gallery vignette above the canvas. All three faked shadow systems (car blobs, ribbon's projected
  shadow plane) were retired in favor of one coherent light.
- **Materials.** The ribbon and the cars moved from raw `ShaderMaterial` to patched
  `MeshStandardMaterial` (`onBeforeCompile`): the telemetry painting logic survived untouched as
  procedural albedo, but now receives light, casts and receives real shadows, and tone-maps
  consistently with the plinth. Wetness is now physical: roughness soaks from 0.88 to 0.26 with
  rainfall, so rain reads as *gloss*, not as a painted shimmer.
- **Textures.** The plinth became a printed base sheet (10 m graph grid, paper grain, edge
  vignette, 100 m scale bar, north arrow, engraved plaque with circuit name / lap length / turn
  count). The asphalt gained grain, a rubbered-in racing line (from brake-heat data), painted
  red/white kerb stripes at every detected corner, a checkered start/finish band, and ember-heat
  tinting. A second, ~3k-tri car model with halo, sidepods and wing detail swaps in at
  conversational zoom.
- **Environment.** The dressing layer (`src/scene/TracksideDressing.tsx`): runoff apron, a low
  barrier wall along the ribbon, grandstand/pit massing detected from the two longest straights,
  the start/finish gantry, marshal posts whose flags fly the *live* sector-yellow/red state, seeded
  tree groves rejection-sampled off the racing line, and instanced rain streaks while the weather
  channel is wet.
- **System.** Contrast repair (`--text-lo` now clears 4.5:1; `--text-ghost` demoted to decorative),
  a semantic z-index ladder, a disabled-state vocabulary, and a `fonts.ready` re-bake so cached-session
  tags never bake fallback monospace into canvas textures.

Verification note: the session that ran this pass had no vision-capable model, so the visual gate
was programmatic — a dependency-free PNG decoder (`scripts/analyze-png.mjs`) comparing frame
statistics against the pre-pass captures. That loop caught and fixed two real defects: an
overexposed first pass (the plinth lifted above the void until the diorama dissolved; fixed by
retuning hemisphere/key/exposure), and an under-lit asphalt albedo (physically-based 1/π falloff
pushed the ribbon into near-black; fixed by pre-lifting the painted palette). Final frames show the
intended separation: background void 74–92%, lit plinth paper ~21–38%, graphite track 2–4%, black
under 0.05%, high-frequency edge density 4× the baseline (grain, kerbs, checker, grid). A human
browser pass remains the outstanding sign-off, as it always was.

### Problems solved during the build

- **A real API bug, not a fluke.** The OpenF1 client's URL builder was double-encoding
  comparison operators — `date>=` was being serialized as `date%3E%3D=...`, i.e. `date>==...`,
  which OpenF1's query parser answers with a bare 500. Manual `curl` probes against the raw API
  confirmed the correct form has no trailing `=` after the encoded operator; fixed in
  `buildUrl()` and verified with a throwaway probe script before rerunning the full pipeline.
- **The API sheds load under sustained pulls.** The 2024 São Paulo GP is a ~2h47m session
  (rain delay, red flag) that produces ~56 fetch windows; firing them all through
  `Promise.all` caused OpenF1 to start 500ing mid-batch, which failed the whole load. Fixed by
  making the windowed fetch resilient: a first pass collects any windows that exhausted their
  retries instead of rejecting, then up to three "recovery sweeps" (with a cooldown) re-fetch
  just the gaps. The full 1.4M-row pipeline for that race now completes reliably in under five
  minutes.
- **Defensive fallback for the track builder.** `buildTrackModel` throws if a session has no
  clean lap with full telemetry coverage (possible for heavily disrupted or very short
  sessions). Since the product promises "any session works," this is caught at the `Theatre`
  level and shown as a clear, actionable message rather than a blank screen.

### Verification performed

- TypeScript strict-mode typecheck and a production Vite build pass cleanly throughout.
- The hero pack (2024 São Paulo GP, session `9636`) was built end-to-end from the live API
  (1,398,809 raw telemetry rows → a 20.7 MB binary pack) and verified against the historical
  record via `scripts/verify-pack.ts`: winner Verstappen (from P17), 69 laps (correctly
  reflecting the rain-shortened race distance), rainfall present in the weather channel, 35 pit
  events, 111 race-control messages, 61 radio clips. The app's own `decodePack()` was
  separately confirmed to read the same file correctly.
- Visual/interactive verification in a live browser was **not completed** in this session —
  the Chrome automation tool was unavailable throughout. The dev server (`localhost:5199`) was
  confirmed to serve the app; a human pass in a real browser (WebGL rendering, shader
  correctness, camera feel, click interactions) is the one outstanding verification step.

---

## 5. Roadmap — what's next

### Already scoped as "beyond v1" (from the original plan)

1. **`LiveSource`** — a real live-session data source. The `SessionSource` interface and
   `RaceClock` (which already supports a wall-clock-locked mode for Join-as-Live) were
   deliberately designed so this plugs in with no changes to the UI or scene layer: a live feed
   just appends rows while the clock runs.
2. **Pit-Wall Command Center mode** — the second concept pitch, not built into v1 by design.
   A denser, more analytical sibling mode: live anomaly surfacing (tire degradation spikes,
   undercut windows), a "pit window optimizer" widget. Likely reuses the Moments Engine and
   `RaceStateIndex` wholesale.
3. **The Butterfly Effect strategy simulator** — the third original pitch. A counterfactual
   sandbox: pick a chaotic historical race, drag a driver's pit stop to a different lap on the
   DNA Strip, and have a probability engine (built from real tire-degradation deltas already
   present in the stint/lap data) recompute and animate how the field would have reshuffled.

### Additional ideas worth considering (not yet scoped in detail)

- **Multi-driver comparison overlay** inside the focus HUD — the dropped Quali Ghost Duel
  concept could return as a *feature* (compare two drivers' telemetry strips side-by-side)
  rather than the whole product's centerpiece.
- **Shareable moments** — since the Moments Engine already timestamps every notable event,
  a "clip this moment" export (a short scrub range + camera angle) would be a natural,
  low-effort feature for a portfolio site to let visitors share specific highlights.
- **Season-level views** — right now every session is loaded independently; a lightweight
  season summary screen (points progression, a compressed drama timeline across a whole
  championship) would use the same underlying pipeline at a different zoom level.
- **Accessibility pass** — X-ray mode and the Density Dial were designed with information
  layering in mind, but a dedicated screen-reader/keyboard-only pass hasn't been done and would
  strengthen the "information design practice" framing of the whole project.
- **Mobile/touch layout** — the current UI assumes a desktop-class viewport and mouse/keyboard
  input (hover-based X-ray, hold-key interactions); a touch-first variant of the Density Dial
  and Director would be needed for a phone-friendly portfolio link.

---

## 6. Files worth knowing about

| Area | Path | What it is |
|---|---|---|
| Plan (as approved) | `C:\Users\rudra\.claude\plans\staged-strolling-quilt.md` | The original plan-mode document this build followed. |
| Data pipeline | `src/data/` | OpenF1 client, resampler, binary pack, IndexedDB cache, `SessionSource`. |
| Engine | `src/engine/` | `RaceClock`, `RaceStateIndex`, `flags.ts`, `moments.ts`, `narrate.ts`, `sampler.ts`. |
| 3D scene | `src/scene/` | Track builder, ribbon shader, cars, battle bridges, camera rig / Director, grid floor. |
| UI | `src/ui/` | Density Dial, timing tower, DNA strip, story feed, focus panel, X-ray layer, session browser, loading screen, onboarding, about overlay. |
| State | `src/state/appStore.ts` | The zustand store — screen/session/density/camera/join-mode. |
| Hero pack tooling | `scripts/snapshot-session.ts`, `scripts/verify-pack.ts` | Build and truth-check a pre-warmed session pack. |
| Hero pack artifact | `public/packs/9636.apx` | 2024 São Paulo GP, pre-warmed (20.7 MB). |

---

Data courtesy of the [OpenF1](https://openf1.org) community API. Team radio © Formula 1.
Unofficial, non-commercial concept — not associated with Formula 1, the FIA, or any team.
