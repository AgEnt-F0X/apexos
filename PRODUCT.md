# Product

## Register

product

## Users

Design- and engineering-literate visitors to a portfolio piece: peers, recruiters, F1 fans,
and data-visualization practitioners. They arrive curious, explore one or two historical
races on a desktop-class screen, and stay if the interface keeps teaching them something.
A secondary audience is the F1-adjacent data community (OpenF1 show-and-tell) evaluating
technical craft. Context: seated, focused, mouse + keyboard, large display; sessions are
short but attention is high.

## Product Purpose

APEX//OS replays any F1 session (2023 onward, OpenF1 + Jolpica data) as a directed 3D
diorama with layered information depth. It exists to prove a thesis: existing projects
display data, this one *interprets* the race and choreographs attention around that
interpretation — at whatever information depth (CINEMA / BROADCAST / ENGINEER) the viewer
asks for. Success = a visitor watches a full race moment unfold, understands something the
timing table alone would not have taught them, and remembers the diorama.

## Brand Personality

A museum diorama: porcelain, ink, one red voice. Three words: **precise, quiet,
confident**. The interface is gallery-white paper with hairline rules and tabular mono
numerals; color is reserved strictly for meaning (team colors, timing semantics, flags)
plus one signal-red accent. Elevation is shadow, never glow; bloom is banned. Voice is
plain-language in BROADCAST, terse machine-log in ENGINEER.

## Anti-references

- Neon-wireframe "cyberpunk tactical" dashboards (the default 3D-data-viz look: dark void,
  glowing edges, particle trails).
- Glassmorphic HUD soup — blur panels stacked on blur panels.
- Flat timing-table clones and dot-on-a-map replay sites (the entire current OpenF1
  ecosystem gap this project exists to differentiate from).
- Bloom, glow, scanlines, and any light-emitting decoration.

## Design Principles

1. **Color is meaning, not decoration.** Team colors, timing semantics, flags, and one
   red voice — nothing else gets saturation.
2. **Elevation is shadow, never glow.** Craft is contact shadows, hairlines, and ink
   hierarchy; nothing emits light that the data doesn't justify.
3. **The world is the dataset.** Telemetry renders as physical state in the diorama
   (diegetic telemetry) before it renders as numbers in panels.
4. **Semantic zoom, not mode switching.** One continuous surface recomposes across the
   Density Dial; components morph, views don't switch.
5. **Honesty.** Every derived number can show its lineage (X-ray mode); the interface
   admits what its data can't promise.

## Accessibility & Inclusion

Reduced-motion is honored globally (all animation collapses under
`prefers-reduced-motion: reduce`). Desktop-first: hover and hold-key interactions (X-ray)
assume a mouse/keyboard; a touch pass is a known gap. WCAG AA for body text is the bar —
micro-labels and ghost text must not carry information available nowhere else. Screen-reader
and keyboard-only passes are documented as not yet done (PROJECT.md roadmap).
