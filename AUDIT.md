# APEX//OS — Critical Portfolio Audit

**Date:** 2026-08-06  
**Scope:** Repository at `D:\Fable` (unstaged master; no commits yet)  
**Method:** README, `PROJECT.md`, source under `src/`, scripts, packs, typecheck. Competitive claims checked against live GitHub / Product-adjacent tools. Where I infer rather than observe, I say so.

---

## Executive Summary

This is **not portfolio-ready yet** — not because the build is a thin shell (it isn't), but because the piece currently sells a sharper story than the code can defend under scrutiny. There is real ownership-level engineering here: an on-demand OpenF1 → APEXPACK → IndexedDB pipeline, a Moments Engine with a drama curve, diegetic track shaders, Join-as-Live with a locked future, and a deliberate porcelain diorama language. That is more product logic than most "F1 + Three.js" demos. The gap is integrity of thesis: copy still claims undercuts, a TV-truck Director, and live-ready completeness that the repo does not contain; visual verification was explicitly never finished (`PROJECT.md` §4); documentation and UI have drifted (neon/tactical pitch → gallery-white orthographic diorama); and the category is crowded with near-identical 3D replay bets, including another project literally named Apex. A hiring manager who opens `About.tsx` and then `moments.ts` will catch the lie in under a minute — and that one catch discounts the genuine work. Fix honesty and one undeniable demo moment before you polish chrome.

---

## Idea Reconstruction

### Core problem (one sentence)

**Existing F1 data tools show telemetry; this project asked whether an interface can interpret a race and choreograph attention around that interpretation, at a depth the user chooses.**

That sentence is reconstructible from `README.md` (thesis block + five patterns) and `PROJECT.md` §1–2 (origin brief + reframed thesis). If you only had the pitch without the Moments Engine / Density Dial / Join-as-Live, the problem statement would collapse into "pretty 3D replay," which the author correctly noted was already occupied.

### Imagined user — honest read

This is **primarily a tool the designer wants to have built and shown**, not a tool a defined user population is waiting for.

Evidence:

- Origin brief in `PROJECT.md` §1 is explicitly "ambitious portfolio piece… insane amounts of data… present it beautifully."
- Teaching "what the pit wall sees" is a secondary framing (`PROJECT.md` §1, X-ray pattern), but there is no research with fans, engineers, or broadcasters — only a scan of OpenF1 show-and-tell (~23 projects) used as competitive gap analysis.
- The Density Dial and X-ray are pedagogical interaction patterns aimed at a portfolio audience who needs the *argument* explained, not a race engineer who needs anomalies flagged.

Inference: you are the primary user (builder + critic). The fictional "pit wall visitor" is scaffolding for the thesis. That is fine for an exploration piece — but then the work must prove the thesis, not pretend to ship an F1 product.

### Original scope vs. what got built

| Layer | Intent (from docs) | Built? |
|---|---|---|
| Three early pitches (Ghost Duel / Pit-Wall / Butterfly) | Explored; Ghost dropped; Pit-Wall + Butterfly deferred | Deferred — honest (`PROJECT.md` §2, §5; `README.md` Roadmap) |
| Synthesized ApexOS (neon tactical + predictive ghosts) | Early vision | **Not built** — visual language pivoted to PORCELAIN (`tokens.css`, `Theatre.tsx`) |
| v1: 3D Race Replay Theatre + five signature patterns | Scoped centerpiece | **Mostly built** (see Current State) |
| Fully on-demand any session 2023+ | User pushback on pre-baked-only | Built (`ReplaySource`, `SessionBrowser`) + hero packs as cache warmers |
| Live sessions (`LiveSource`) | Architecture "live-shaped" | **Seam only** — `SessionSource` interface in `source.ts`; no `LiveSource` class exists |
| Visual/browser verification | Outstanding | **Not done** (`PROJECT.md` §4: Chrome automation unavailable; human WebGL pass still owed) |

Where it stalled (observable, not inferred):

- Roadmap items remain roadmap (`README.md` lines 69–71).
- Docs still describe an older Director ("TV truck," trackside tripod) while `CameraRig.tsx` is explicitly a porcelain isometric turntable with three moves (plate / follow / pair).
- `@react-three/postprocessing` sits in `package.json` with **zero imports** in `src/` — leftover from a bloom/neon path that was abandoned for "Bloom is dead" (`tokens.css`).
- Git history cannot show the stall: **branch `master` has no commits**; everything is staged/untracked. That is itself a finding — a portfolio exploration without a recoverable decision trail.

---

## Current State Audit

### What works end-to-end if a stranger clones and runs

Observed path:

1. `npm install` / `npm run dev` (Vite on port from config; README says `5199`).
2. `npm run typecheck` — **passes** (ran 2026-08-06).
3. Session browser lists years 2023→current, meetings via OpenF1, latest-race hero + signature São Paulo 2024 (`SessionBrowser.tsx`, packs `public/packs/9636.apx` and `9523.apx` present on disk).
4. Load path: hero pack fetch → else worker → IndexedDB → API (`source.ts`, `sessionWorker.ts`, `sessionLoader.ts`).
5. Theatre: track extruded from telemetry (`trackBuilder.ts`), cars instanced (`Cars.tsx`), battle bridges, DNA strip, timing tower, story feed, density dial, transport, Join-as-Live clock lock (`appStore.ts` + `RaceClock.ts`).

This is a **real pipeline**, not mock JSON standing in for a race. The hero pack is the same APEXPACK artifact the worker builds (`source.ts` comments; `scripts/snapshot-session.ts` / `verify-pack.ts`).

### Broken, stubbed, hardcoded, or overclaimed

| Claim / surface | Reality in code |
|---|---|
| Moments Engine derives **undercuts** | **False.** `moments.ts` builds overtakes, pits, fastest laps, battles, flags, rain, race start/chequered. No undercut detection. Claim appears in `About.tsx` pipeline step 04 and `PROJECT.md` §4. |
| Director "cuts like a **TV truck**" / trackside tripod | **Stale.** `CameraRig.tsx` header: orthographic isometric diorama; grammar = plate / follow / pair. README pattern 5 still sells TV-truck language. |
| `LiveSource` already live-shaped | **Partial.** `SessionSource` + `RaceClock` modes exist; no live append implementation. |
| Join-as-Live = "wall-clock-locked" | **Overstated.** `RaceClock.tick` advances `dt * rate` at rate 1; `seek` no-ops in `broadcast-locked`. Spoiler lock is real; calendar sync to original broadcast wall time is not. |
| Narration as "interpretation" | **Template copy**, not ML (`narrate.ts` switch on `MomentType`). Fine — but do not frame it as AI. |
| Pre-warmed first impression | Packs exist (~21 MB each). Cold load still ~1–2 min from API (honestly labeled in browser). |
| Density Dial "morphs; nothing toggles" | Mostly CSS opacity / mount gates (`Shell.tsx`, `app.css` `.shell.density-0`). Components still mount/unmount (e.g. `FocusPanel` only if density ≥ 1 and focus set). Acceptable MVP of semantic zoom; not a continuous morph system. |

**Join-as-Live interaction bug (observed):** In `DnaStrip.tsx`, pointer-down still sets `raceClock.scrubbing = true` and calls `seekFrom`. In join mode `seek` is a no-op, but `scrubbing` freezes `tick()` (`RaceClock.ts`: `if (!this.playing \|\| this.scrubbing) return`). Dragging the DNA strip during "live" **pauses the broadcast**. That undermines the signature product idea.

### UI states map

| Surface | Empty | Loading | Error | Edge |
|---|---|---|---|---|
| Session archive | "NO MEETINGS…" | "QUERYING ARCHIVE…" | Busy + auto-retry countdown + RETRY (`SessionBrowser.tsx`) | Sessions fetch fail → empty list + "API BUSY — CLICK TO RETRY" |
| Latest race hero | Em dash while querying | "FINDING THE LATEST RACE…" | "ARCHIVE UNREACHABLE — TRY SIGNATURE" | CTAs disabled until latest resolves |
| Session load | — | Designed multi-stage `LoadingScreen.tsx` | Toast "ACQUISITION FAILED" → back to browser (`App.tsx` / `appStore`) | Cancel mid-load via exit |
| Track build | — | — | `Theatre.tsx` `buildError` panel with actionable copy | Sessions without clean lap telemetry |
| Story feed | CINEMA: null if no fresh moment | — | — | Join mode: seek from feed still calls `raceClock.seek` → no-op |
| Timing tower | `return null` if no rows | — | — | Retired / PIT flags |
| X-ray | Off unless hold X | — | — | Fixed viewport anchors — will misalign on resize/mobile |
| Radio | — | — | `play().catch` swallow (`radioPlayer.ts`) | CORS / autoplay failures silent |
| Mobile / touch | — | — | — | **No responsive breakpoints** in `app.css` (grep: no `@media` layout breakpoints; only reduced-motion in `tokens.css`). Desktop keyboard product by design (`PROJECT.md` §5). |

Happy-path density is high. Unhappy paths for **network acquisition** are unusually serious for a portfolio piece. Unhappy paths for **interpretation quality** (false overtakes, missed battles) are absent — the feed always sounds confident.

### AI / LLM integration

**There is none.** Interpretation is heuristic + string templates. Treat claims of "intelligence" as product language for the Moments Engine, not model inference. Failure modes that matter are: wrong moments, silent radio failure, OpenF1 shedding load (handled with concurrency limits, cooldown, recovery sweeps in `openf1.ts` / `sessionLoader.ts`), and track build failures (handled).

### Completion vs. original scope (not vs. redefined MVP)

| Against | Estimate | Rationale |
|---|---|---|
| Scoped v1 (3D theatre + five patterns, replay-only) | **~72%** | Patterns exist in code; Director/docs drift; Join-as-Live has a scrub-freeze bug; undercuts claimed not built; browser visual QA unpaid; no commit history / deploy story in-repo |
| Original ApexOS mega-vision (ghosts + pit wall + butterfly + neon command) | **~35%** | Explicitly deferred; visual language abandoned |
| "Hiring-manager-ready portfolio argument" | **~50%** | Thesis is interesting; evidence package is incomplete and partially dishonest |

---

## Competitive Landscape

Adjacent attention market: indie OpenF1 / FastF1 tools, creative-coding race viz, fan utilities — **not** enterprise SaaS.

| Project | Core bet | What they understood that this repo hasn't fully absorbed |
|---|---|---|
| **[MultiViewer](https://multiviewer.app/)** (+ Race Trace) | Sync F1TV with live timing; Race Trace makes the whole race legible as a gap genome | The DNA strip idea already has a beloved cousin in the wild. Differentiation cannot be "bump chart of the race" alone — MultiViewer owns "fan tool that becomes habit during race weekends." Your edge must be *spatial choreography + density as thesis*, not the strip. |
| **[misha-met/Delta](https://github.com/misha-met/Delta)** | Browser pit-wall console: 10 dockable panels, FastF1 Arrow cache, 3D + cockpit POV | Depth-of-engineering console for people who already think in stints and gaps. They bet on **utility density**. Your Density Dial is the inverse bet (semantic zoom). If ENGINEER mode is thinner than Delta's panels, the dial looks rhetorical. |
| **[MatthewDelong/F1-Telemetry](https://github.com/MatthewDelong/F1-Telemetry)** (F1nsight lineage) | Broad analytics + 3D viewer + live dashboard across series | Feature breadth and calendar usefulness. They win on "I come back every weekend." You cannot out-feature this; you must out-*concept*. |
| **[wrick17/F1-replay](https://github.com/wrick17/F1-replay)** | OpenF1 3D replay + season dashboard shell | Same stack neighborhood (React/Three). Proves 3D replay is table stakes, not a portfolio thesis by itself. |
| **[adi21anand/APEX](https://github.com/adi21anand/APEX)** | Hackathon 3D replay that "reconstructs the story of the race" | **Name collision + nearly identical elevator pitch.** Even if their build is thinner, a hiring manager googling "Apex F1" will not grant you uniqueness by default. |

Also noted in your own research (`PROJECT.md` §1): Pitbrain, f1data.live, F1 Pitwall, Race Control, etc. — mostly flat dashboards / dot maps. Your diagnosis of that gap was correct.

### Unclaimed angle — or slightly-worse remake?

**There is a genuinely unclaimed angle, partially built:** *interpretation as choreography* (Moments → Director + temporal lensing + Join-as-Live future lock + diegetic asphalt), especially under the porcelain diorama register (museum model of a race, not another dark neon track).

**It is currently at risk of reading as a slightly-better-looking remake of Apex/F1-replay** because:

1. The marketing still leads with "3D race intelligence engine" (category noun) rather than "spoiler-free interpreted broadcast" or "semantic zoom into race literacy" (unique noun).
2. Docs overclaim features peers could also fake in copy.
3. The porcelain pivot is the strongest visual differentiator in the code — and the README still half-sells the abandoned TV-truck fantasy.

Direct verdict: **unclaimed angle exists; present packaging often fails to claim it cleanly.**

---

## Three Reframed Directions + Recommendation

### Direction A — "Interpreted Broadcast" (double down on the thesis you already coded)

**Bet:** The product is not a replay viewer; it is a system that decides what matters and performs it — and the user can audit those decisions.

**Concrete changes:** Delete undercuts/TV-truck/LiveSource overclaims. Fix Join-as-Live scrub freeze. Add an inspectable Moments panel (why this overtake fired; severity; raw gap/position evidence). Make Join-as-Live + DNA future-veil the hero path from the browser. Ship a 60s recorded demo of São Paulo with lensing on.

**Effort (AI-assisted):** ~3–6 focused days.

**Proves:** You can own a concept end-to-end — product logic, interaction, honesty under code review.

**Risk / who bears it:** If Moments quality is noisy, inspectability exposes the heuristic as crude. Bearer: you (a week that makes the engine look weaker). Better than a pretty lie.

### Direction B — "Butterfly Genome" (counterfactual strategy sandbox)

**Bet:** The interesting object is not watching history but rewriting it — drag a pit on the DNA strip and watch the field reshuffle.

**Concrete changes:** Probability/physics model over stint degradation; alternate timelines; comparison DNA; heavy ENGINEER mode. Theatre becomes consequence visualization.

**Effort:** ~2–4 weeks for a credible thin slice; longer for something that doesn't feel fake.

**Proves:** Systems thinking + willingness to invent product mechanics, not just viz craft.

**Risk / who bears it:** High. Fake physics reads as toy; real physics is a research project. Bearer: portfolio (unfinished again) and you (wasted weeks). This was correctly deferred in `PROJECT.md`.

### Direction C — "Porcelain Specimens" (information-design manifesto as the product)

**Bet:** F1 is the specimen; the piece is a public argument about diegetic data and semantic zoom, packaged as a short series of curated races with X-ray as the star.

**Concrete changes:** Narrow to 2–3 curated packs; editorial onboarding; strip "any session" ambition from the hero path; treat About/X-ray as first-class; publish a written case study that matches the porcelain code (not the neon pitch).

**Effort:** ~1–2 weeks of curation + writing + UI edit.

**Proves:** Taste, editorial judgment, design engineering maturity — strong for design-hire paths.

**Risk / who bears it:** Engineers may call it "a demo with essays." Bearer: breadth of "full archive explorer" story you already invested in.

### Recommendation

**Do Direction A. Park B. Use a light touch of C only as packaging for A.**

Why A wins: the hard systems are already ~70% present; the failure mode is credibility, not invention. Why not B: it reopens the highest-risk original pitch and resets completion. Why not full C: abandoning on-demand archive wastes a real differentiator vs. single-race demos — but stealing C's honesty (curated signature path + matching case copy) strengthens A.

---

## UI Direction

### What this category looks like right now (cited, not filler)

- **Fan utility chrome:** MultiViewer / Race Trace — dark functional panels, sync with broadcast, race-as-genome charts. Habit tools, not gallery pieces.
- **Pit-wall density:** Delta-style multi-panel consoles — prove seriousness via information volume.
- **Browser 3D replays:** Apex / F1-replay / F1-Telemetry — dark tracks, chase cams, timing towers. The default aesthetic this repo already abandoned in code (`Theatre.tsx`: `#eef1f5` void, orthographic, "gallery light").
- **Spatial / interpretive viz culture:** Observable-style inspectability (show your working); production Three.js guidance that 3D must carry meaning, not decoration (e.g. current Three.js interface writing that treats 3D as a last resort when structure needs a third axis). Your diegetic asphalt / battle bridges are on the right side of that argument when they encode brake heat and gap tension.

Your porcelain diorama is **more current as a creative bet** than another bloom-neon track. Lean into museum-model confidence: cool light, ink hairlines, one red voice (`tokens.css`) — then push motion and diegesis harder, not "add glassmorphism."

### Component system — what exists vs. what you need

**Exists today:** design tokens (`tokens.css`), shared utilities (`.panel`, `.label`, `.mono`), screen-level React files under `src/ui/*` composed by `Shell.tsx`. This is **one-off product markup**, not a component library — fine for a concept, weak if you claim a design system.

**Needed for the thesis (components / variants / states):**

| Component | Variants | States that must exist |
|---|---|---|
| `DensityShell` | CINEMA / BROADCAST / ENGINEER | Recompose without layout jump; reduced-motion |
| `MomentCard` | broadcast prose / engineer log | new, stale, selected, **disputed/low-confidence**, empty ("no moments yet") |
| `DnaStrip` | replay / join-locked | scrubbing, moment-gravity snap, radio-hit, **join: scrub disabled**, loading threads |
| `DirectorBadge` | auto / manual override | cutting, holding, user-took-wheel |
| `LineageNote` (X-ray) | anchored to live layout boxes | missing target, density-filtered |
| `AcquireToast` | fail / retrying | already partly present |
| `CircuitFault` | no clean lap | already present in `Theatre.tsx` |

### Where motion / generative visuals earn their keep

**Serve the tool:** temporal lensing rate changes; tower row glide on position swap; battle-bridge tension color; brake-heat accumulation; Join-as-Live future veil advancing; Director hard cuts on high-severity moments.

**Decoration to refuse:** particle throttle trails for spectacle, bloom revival, ambient camera drift unrelated to moments, generative noise backgrounds. The porcelain brief already killed bloom — keep that discipline.

### Stretch vs. fallback (AI-assisted build)

| Stretch | Fallback if time dies |
|---|---|
| Continuous semantic zoom (true morph) | Three discrete densities with shared spatial anchors (current approach) |
| Layout-aware X-ray (measure DOM boxes) | Fewer notes; key-only "explain this panel" |
| LiveSource race weekend | Join-as-Live on historical packs only (already the proof of clock architecture) |
| Full mobile touch Director | Desktop-only, stated in UI; portrait = "open on a wide display" interstitial |

---

## Critical Risks

### What breaks first if someone actually depends on this?

1. **OpenF1 availability / rate limits** on cold loads of non-hero sessions — mitigated but still a hard dependency (`sessionLoader.ts` can throw after recovery sweeps).
2. **Join-as-Live scrub freeze** — breaks the spoiler-free promise in the hand, not just in theory.
3. **Moments false positives** (grid noise filtered weakly; battles from interval stream) — users who "depend" on the story feed for truth get confident wrong narration (`narrate.ts` never hedges).
4. **Desktop-only WebGL + keyboard** — portfolio link on a phone is a dead end (no layout breakpoints).

### Weakest part you're most likely to be defensive about

**Overclaim vs. `moments.ts`.** Specifically undercuts in `About.tsx` / `PROJECT.md`, and Director language in `README.md` that doesn't match `CameraRig.tsx`. Defensiveness here is a tell: the engineering ego wants credit for the full vision; a reviewer wants isomorphism between story and source. Related: unused `postprocessing` dependency and "LiveSource ready" roadmap tone.

### How to measure whether an "improved" version is better (not vibes)

Pick **one** primary signal and one integrity gate:

1. **Primary signal:** In a moderated 5-person walkthrough (designers or F1-curious builders), after 90 seconds on Join-as-Live São Paulo with no coaching, can ≥3/5 correctly explain *what the interface decided mattered* in the last minute (overtake / SC / battle) **and** point to where they'd verify it (DNA strip, tower, X-ray lineage)? Pass threshold: 3/5.
2. **Integrity gate:** A cold reader given `README.md` + `About.tsx` + 20 minutes in `src/engine` and `src/scene/CameraRig.tsx` finds **zero** feature claims without a code referent. Binary pass/fail.

Secondary (optional): cold-load success rate for a non-pack session over 10 trials; Join-as-Live: zero pause from DNA interaction.

### If you only fix one thing before a hiring manager sees it

**Make the interpretation layer honest and inspectable — and delete every claim the code cannot defend.**

Why over polish, Butterfly, LiveSource, or a visual reskin: a manager who trusts your About page will trust the diegetic shaders and the pack pipeline; a manager who catches "undercuts" with no implementation will assume the rest is theatre. Honesty converts your real ~70% build into a credible argument. Polish on top of overclaim converts it into a liability.

---

## Next Action

**Open `About.tsx`, `README.md`, and `PROJECT.md`, delete every feature claim that is not true in `moments.ts` / `CameraRig.tsx` / `source.ts` today, then add a single in-theatre "why this moment" inspector wired to the Moments Engine and fix the Join-as-Live DNA scrub-freeze — and only after that record a 60-second São Paulo demo.** That one sequence turns the thesis from marketing into evidence.
