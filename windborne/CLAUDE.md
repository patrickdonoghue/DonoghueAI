# Windborne — working agreement

A browser WebGL experience: you are the wind, carrying a flower petal across a landscape, blooming flowers and returning colour to dead terrain. No failure state, no HUD, no text. An original homage to *Flower* (thatgamecompany, 2009).

**Read `docs/windborne-prd.md` before doing anything.** It is the spec. This file is how we work.

## Files that already exist

These are written and reviewed. Use them; do not recreate or rewrite them without asking.

| File | What it is |
|---|---|
| `docs/windborne-prd.md` | The spec. Phases, mechanics, acceptance criteria. |
| `src/config/tuning.ts` | Every feel constant, with starting values and rationale. |
| `src/config/palettes.ts` | Dream 1 colour definitions and the `Palette` type. |

`tuning.ts` and `palettes.ts` export constants for systems that don't exist yet. Unused exports are expected — that is not dead code to clean up. Wire each one in as its phase arrives.

---

## Prime directive: stop at every phase gate

The build is divided into phases (PRD §12). Each ends with a **hard stop**.

When a phase's acceptance criteria are met:

1. Stop writing code.
2. Post a short summary: what was built, what the acceptance criteria were, and how you verified each one.
3. Say what you'd do first in the next phase.
4. **Wait.** Do not start the next phase until Patrick says go.

This is not a formality. Most of the phases have subjective acceptance criteria — "does flying feel good" — that only Patrick can evaluate, and evaluating them requires that nothing else has been built on top yet. A phase that runs long produces a diff nobody can review.

If you finish a phase early and are unsure whether a piece belongs to this phase or the next, ask. Do not build it and ask later.

## Phase 0 is the whole project

Phase 0 is a grey plane, a cone, a camera, and the input system. It will feel like a warm-up. It is not. Every later phase is decoration on the flight model, and the flight model can only be judged in isolation. Expect to iterate on it several times. That is the phase working correctly, not the phase going badly.

---

## Locked decisions

Do not revisit these without asking.

- **Three.js, vanilla.** No React, no R3F, no reconciler. Imperative scene graph.
- **TypeScript**, `strict: true`. No `any` outside genuinely untyped third-party surfaces.
- **Vite.** Static output. Deploys to GitHub Pages — set `base: '/<repo-name>/'` in `vite.config.ts` early, before it bites us.
- **No physics engine.** The flight model is vector math in `WindController.ts`.
- **No audio files.** All sound synthesised at runtime via Web Audio.
- **No asset pipeline.** Geometry is generated in code, textures are generated procedurally or authored as small SVG/canvas draws. If you find yourself wanting to load a `.glb`, stop and ask.

## Dependencies

Currently allowed: `three`, `simplex-noise`, `tweakpane` (dev only).

**Ask before adding anything else.** Small payload is a product requirement (PRD §4), not a preference.

---

## Code conventions

**All feel constants live in `src/config/tuning.ts`.** Every one of them, with a comment explaining what it does in plain language and what happens if you raise or lower it. Patrick tunes this file directly and shouldn't have to read shader code to find a number. If you write a numeric literal that affects how the game feels or looks, it belongs in `tuning.ts` or `palettes.ts` instead.

Genuine constants of the implementation — buffer strides, bytes per float, ring buffer sizes derived from other constants — stay local. Use judgement: the test is whether Patrick might reasonably want to change it.

**Zero allocation in the frame loop.** No `new THREE.Vector3()` inside `update()` or `render()`. Pre-allocate scratch vectors at module scope, pool every particle and petal. This is a real constraint with 120k instanced blades and a 60 Hz fixed step — GC pauses will read as stutter and get blamed on the flight model.

**Fixed timestep.** Simulation at 60 Hz, render interpolated. Feel must not change with framerate.

**Shaders live in `.glsl` files** under `src/render/shaders/`, imported as strings via Vite's `?raw`. Not template literals inline in TypeScript. They get long and they need syntax highlighting.

**Comment the shader math.** Especially the grass blade vertex shader. Write it for someone reading it in three months who wants to change how the wind looks.

## Git

- One branch per phase: `phase-0-flight`, `phase-1-grass`, and so on.
- Small commits with plain-language messages. `add gust wave layer to grass wind`, not `feat(grass): implement WindLayer2`.
- Never commit directly to `main`. Patrick merges after reviewing a phase.
- Never force-push, never rewrite history, never `git reset --hard` on work that isn't yours.

---

## Verification

Acceptance criteria that cite numbers need instrumentation to check them, so **build the perf HUD in Phase 0**:

- Frame time (ms), rolling average and 1% worst
- Draw calls, triangles, programs
- Instance counts by system
- Current quality tier

Toggle with `` ` ``. Dev builds only. When you report a phase complete, report actual measured numbers from this HUD on the target machine, not estimates.

For subjective criteria, don't self-assess. Say what you built, say it's ready for Patrick to judge, and stop.

---

## Things not to do

- **Don't build ahead of the phase.** No "I also went ahead and added..."
- **Don't refactor across phase boundaries** without asking. Phase 4 is not the time to restructure Phase 1's chunking.
- **Don't add features that aren't in the PRD.** If you think of a good one, say so and let Patrick decide. Every feature is checked against PRD §1.4: does it make the player calmer and more curious, or tense and goal-directed?
- **Don't add UI.** The persistent interface is one speaker glyph. That's the whole UI budget.
- **Don't guess at level content.** Flower placement is authored by Patrick with the tool in §7.4. If you need placeholder flowers to test a system, use an obviously temporary grid and label it as such.
- **Don't touch the IP constraints in PRD §1.3.** No assets, audio, names, or level layouts sourced from the original game. If a task seems to require it, stop and ask.

## When you're stuck or unsure

Say so early. A question at the start of a phase costs a message; a wrong assumption discovered at the end of one costs the phase. Patrick has a design and CAD background and is building web development skills — explain tradeoffs in terms of what they'll change about the result, not just the implementation.
