# APEX//OS — F1 Spatial Race Intelligence Engine

**Concept 001 · a design exploration in spatial information design.**

Every F1 session since 2023 broadcast ~500,000 rows of raw telemetry. Existing tools display
that data — timing screens, dot-maps, charts. APEX//OS **interprets** it, then performs the
race for you: a directed 3D broadcast with a pit wall's depth of intelligence, at whatever
information density you ask for.

Built as a portfolio concept by a product designer, testing one thesis:

> *Interfaces of the next generation won't display data. They'll interpret it, and
> choreograph your attention around that interpretation.*

## The five signature patterns

1. **Diegetic telemetry** — data lives in the world, not in panels. Braking heat glows on the
   asphalt (accumulated from the whole field's brake channel). Battles are taut light-bridges
   whose color is the gap. Tire compound and age live on the car's wheels. Rain soaks the track
   surface. Yellow sectors pulse on the ribbon itself.
2. **Semantic zoom (the Density Dial)** — one surface, three depths: CINEMA / BROADCAST /
   ENGINEER. The interface recomposes; nothing toggles. Key `D`.
3. **Temporal lensing** — a Moments Engine scores drama density across the whole race;
   directed playback compresses cruise laps and slows for the action. The Race DNA Strip
   (the scrubber) shows the race's topology — position threads, safety-car bands, rain
   texture, pit notches, radio pins — and the playhead settles onto story beats. Key `A`.
4. **X-ray mode** — hold `X`: the interface annotates itself in place, down to the data
   lineage of every number. Inspection mode for a broadcast.
5. **The Director** — a quiet camera grammar (plate / follow / pair) driven by the same
   interpretation layer: it holds through a pass, goes wide when the field spreads, and
   hands control to the user on one keypress. And **Join as Live**: enter any historical
   race with the future genuinely hidden — no scrubbing ahead, no spoilers, the DNA strip
   only knows the past.

## Data pipeline (fully on-demand)

```
OpenF1 API ──▶ windowed, rate-limited fetch (web worker)
           ──▶ uniform 5 Hz resample of motion channels
           ──▶ APEXPACK binary columns (one artifact)
           ──▶ IndexedDB cache (instant revisits)
           ──▶ Moments Engine (overtakes, battles, flags, weather, drama curve)
           ──▶ the theatre
```

The circuit geometry is **extruded from the telemetry itself** — the fastest clean lap's
positional trace becomes the arc-length-parametrized ribbon. No track model files exist.

A pre-warmed hero pack (`public/packs/9636.apx`, 2024 São Paulo GP) is the same artifact the
worker builds, snapshot ahead of time so first-time visitors skip the ~1–2 min cold fetch.

## Run

```bash
npm install
npm run dev          # http://localhost:5199
npm run build        # production build (typecheck + vite)

# rebuild / add a hero pack:
npx tsx scripts/snapshot-session.ts 9636
npx tsx scripts/verify-pack.ts 9636   # truth-check against the historical record
```

## Stack

React 19 · three.js / react-three-fiber · zustand · custom GLSL (ribbon, cars) ·
hand-rolled canvas viz (DNA strip, telemetry strips) · web worker + IndexedDB · Vite.

## Roadmap

Live sessions (`LiveSource` — the RaceClock and data model are already live-shaped) →
Pit-Wall Command Center mode → the Butterfly strategy sandbox (counterfactual pit calls).

---

Data courtesy of the [OpenF1](https://openf1.org) community API. Team radio © Formula 1.
Unofficial, non-commercial concept — not associated with Formula 1, the FIA, or any team.
