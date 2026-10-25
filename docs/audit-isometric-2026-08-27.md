# AUDIT — Isometric design implementation

**Date:** 2026-08-27
**Scope:** Whether the theatre's presentation matches the PLAN §0.5 / AUDIT "porcelain
diorama, orthographic near-isometric" contract. Method: full source audit of the scene
stack + an offline mathematical audit reproduced from the exact camera constants, run
against all 24 baked circuits.

`npx tsx scripts/audit-theatre-iso.ts` — permanent headless gate, exits nonzero on failure.

---

## Verdict: ✅ PROPERLY IMPLEMENTED (true isometric, one spec-band nuance)

The diorama is **true isometric**, not merely "inspired by". Every contract verified:

| Contract (PLAN §0.5 / CameraRig header) | Implementation | Audit |
|---|---|---|
| Orthographic projection | `<Canvas orthographic>`; zero `PerspectiveCamera`/`fov` in `src/` | ✓ PASS |
| Fixed elevated angle, classic iso | `ISO_ELEV = atan(1/√2) ≈ 35.264°` (exact) | ✓ PASS |
| Four-plate turntable | azimuths 45º / 135º / 225º / 315º | ✓ PASS |
| Elevation never tilts | OrbitControls `minPolarAngle == maxPolarAngle`; Director places camera on the iso sphere every frame | ✓ PASS |
| Plinth framing — never crops | `fitSpan` projects the plinth corners through the iso matrix with ×1.04 margin; **all 24 circuits × 4 plates = zero crops** | ✓ PASS |
| Iso foreshortening | axes foreshorten √3∶1, each at exactly 30° to screen-horizontal (the iso invariant) | ✓ PASS |
| Clip depth | camera D = `radius·5+500` ≤ 7465 ≪ ortho `near -50000 / far 50000` | ✓ PASS |
| World-axis consistency | cars, battle bridges, tags, and furniture all map `(x, y = z−elev, z = −north)` into the projector's (x,z) plane; cars rotate about Y only — flat game-pieces on the plinth | ✓ PASS |
| Porcelain register | gallery-white void `#eef1f5`, soft hemisphere + one cool key, contact shadows, no bloom | ✓ PASS |
| Iso-label convention | tags/bridges/chips are constant-screen-size sprites (`sizeAttenuation:false`, zoom-normalised), always facing the camera — the standard iso-diorama annotation rule | ✓ PASS |
| Runtime integrity guards | NaN guards on `span`/`az`/`target` every frame; `top` mode has the +0.001·D gimbal guard | ✓ PASS |

## One spec nuance to note (non-blocking)

PLAN §0.5 says *"~30–35°, near-isometric **but legibility-tuned**"* — i.e. it implies a
slightly-lowered elevation chosen for readability. The code uses exactly 35.264°
(TRUE isometric, the top of the band). Both readings are defensible and it is the more
"correct" isometric, but it is the one deviation from the stated band. If the owner wants
the legibility-tuned look, lower `ISO_ELEV` to ≈30–32° — the framing math
(`fitSpan`/clip/plates) is elevation-parameterised and holds at any angle. **Key `4` (top
down) is a deliberate non-iso PLAN view, labeled as such.**

## Carried-over caveats (not iso violations)

- The `DnaStrip` is a 2D "genome" topology, intentionally *not* an iso projection — out of
  scope for this audit.
- Live/human browser verification of the rendered pixels remains undone (no browser harness
  in this environment) — the mathematical invariants above are the strongest check
  available headlessly.