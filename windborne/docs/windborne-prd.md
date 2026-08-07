# Windborne — Product Requirements Document

**A browser-based interactive poem in the spirit of *Flower* (thatgamecompany, 2009)**

Version 0.2 — stack and authoring decisions resolved
Owner: Patrick
Intended builder: Claude Code

**Companion files:** `CLAUDE.md` (working agreement — Claude Code reads this first), `tuning.ts` (all feel constants), `palettes.ts` (colour definitions).

---

## 0. How to read this document

Sections 1–4 are the *what and why* — review these first and push back hard, because everything downstream depends on them.
Sections 5–11 are the *how* — the technical spec Claude Code will work from.
Section 12 is the build plan with acceptance criteria per phase.
Section 13 is a list of decisions I need from you before a line of code gets written.

---

## 1. Intent

### 1.1 What this is

A single-page WebGL experience where the player is a gust of wind carrying a flower petal across a landscape. Flying through flowers blooms them, adds petals to a growing trail, and returns colour and life to dead terrain. There is no failure state, no score, no timer, no text. The experience is the reward.

### 1.2 What it is not

- Not a port, decompilation, or asset-level copy of *Flower*.
- Not a game with combat, inventory, dialogue, or UI chrome.
- Not a photorealistic renderer. Stylised, painterly, saturated.
- Not a level editor or a toolkit. One authored experience.

### 1.3 IP position (important — read before building)

*Flower* is owned by Sony/thatgamecompany. Game mechanics and design ideas are not copyrightable; specific assets, music, level layouts, logos, and the title are. This project is therefore built as an **original homage**, under these hard constraints:

| Rule | Detail |
|---|---|
| Original name | Working title *Windborne*. Do not ship anything titled "Flower". |
| Original assets | Every mesh, texture, and shader is written or procedurally generated for this project. No ripped models, textures, or heightmaps. |
| Original audio | All audio synthesised at runtime via Web Audio (see §9). No soundtrack samples, no recreations of Vincent Diamante's score. |
| Original level layouts | Terrain and flower placement are our own. Do not attempt to reconstruct the original levels from playthrough footage. |
| Attribution | A single line in the About panel: "Inspired by *Flower* (thatgamecompany, 2009)." Honest, not a claim of affiliation. |

This is a mechanic-and-mood study, which is legitimate and commonplace. Just don't let it drift into reproduction.

### 1.4 The one-sentence design test

Every feature decision gets checked against this: **does it make the player calmer and more curious, or does it make them tense and goal-directed?** If the latter, cut it. The original team's stated method was removing mechanics that didn't produce the target emotion, and that discipline is the whole ballgame here.

---

## 2. Reference research: what *Flower* actually does

Condensed from primary and secondary sources so we're designing against reality rather than memory.

### 2.1 Core loop

- The player controls **the wind**, not the petal. The petal is what you can see; the wind is what you steer. This distinction matters for the camera and the feel of momentum.
- Flying near a flower makes it **bloom** and adds **one petal** to a trailing ribbon behind the lead petal.
- **More petals = faster movement.** The trail is both progress meter and power-up.
- Blooming specific flowers or clusters **changes the world**: dead grey grass turns green, dead trees revive, gates open, windmills spin, lights illuminate. These changes typically spawn the next set of flowers, which is how the player is guided without a HUD.
- Each bloom plays a **musical chime** that harmonises with the score. The player is composing a countermelody. This is the single most important non-visual feature.
- No hit points, no enemies (except one late level), no time limits, no way to lose.
- A **swirling wind vortex** marks the level exit.

### 2.2 Structure

Six "dreams" plus a credits level, framed by a hub: potted flowers on the windowsill of a drab city apartment. Each dream is one flower's daydream. Completing dreams makes the apartment and the view outside progressively brighter. Three hidden flowers per level are the only collectible.

The emotional arc across the six:

| Dream | Mood | Introduced mechanic |
|---|---|---|
| 1 | Pastoral, gentle, green | Basic flight, bloom, colour restoration |
| 2 | Warmer, more open, ends in rain | Larger scale, weather shift |
| 3 | Fast, canyon-like, rolls into sunset | Speed, verticality, tonal shift mid-level |
| 4 | Night, windmills, string lights | Illumination; ends with a fuse failing — the turn |
| 5 | Grey, ruined, threatening | The only level with damage; electrical hazards |
| 6 | Dark city → triumphant restoration | Charged petals break structures, city healed |

The whole arc is roughly one hour. Level start positions imply geographic continuity with the previous level's ending.

### 2.3 Visual and technical notes

- Grass is the hero asset. The PS3 version animated on the order of 200,000 blades. That number is a target to *aspire toward on desktop*, not a requirement — see §10.
- Wind is legible everywhere: grass, petals, trees, cloth, dust. If the wind isn't visible, the game doesn't read.
- No text, no HUD, no tutorial. Every affordance is taught by the camera and by flower placement.

---

## 3. Scope

Six dreams is a year of work. Here's the honest cut:

### v0.1 — Vertical slice (the only thing that matters right now)

One dream. Pastoral, daylight, roughly 4–6 minutes of play. Contains: flight, grass, petal trail, blooming, the vitality/colour-restoration system, three gated sections, one exit vortex, full procedural audio. **If the vertical slice doesn't feel good, no amount of additional levels will save it.**

### v1.0 — Shippable

Three dreams (pastoral → golden/sunset → night with lights), plus the windowsill hub with progression state in `localStorage`, plus hidden flowers.

### v2.0 — Stretch

The dark city arc (dreams 5–6). This is a different game technically — hazards, damage feedback, destructible structures, dense urban geometry — and should be planned separately.

**Everything below specifies v0.1 unless noted.**

---

## 4. Platform and audience

- **Primary:** desktop Chrome/Edge/Safari/Firefox, 1080p, 60fps, mouse or gamepad.
- **Secondary:** iPad and modern Android tablets, 30fps floor, touch drag + optional device tilt.
- **Tertiary:** phones. Reduced quality tier, must not crash. Not the target.
- **Delivery:** static site, GitHub Pages. No backend, no accounts, no analytics.
- **Budget:** initial payload under 3 MB gzipped. Achievable because nearly everything is procedural.

---

## 5. Core mechanics

### 5.1 Flight model

Not a flight simulator. A steerable current.

```
state: position, velocity (vec3), speed (scalar), petalCount
input: desiredDirection (vec3, unit), boost (0..1)
```

- Velocity direction rotates toward `desiredDirection` at a **capped angular rate** (`TURN_RATE`, rad/s). The cap is what makes it feel like wind rather than a cursor. Turn rate decreases slightly at high speed.
- Speed lerps toward `targetSpeed = BASE_SPEED * (1 + BOOST_GAIN * boost) * petalSpeedMultiplier`.
- `petalSpeedMultiplier = 1 + PETAL_SPEED_K * sqrt(petalCount)`. Square root, so the 80th petal doesn't make it uncontrollable.
- **Terrain avoidance, not collision.** When altitude above terrain drops below `MIN_ALTITUDE`, apply an upward force proportional to the shortfall. The player physically cannot crash. They can graze the grass, which they should be encouraged to do — grass deflects around them (§6.3).
- **Soft boundaries.** Approaching the level edge applies a rotating force that curves the player back inward, plus a visible gust of dust/leaves. No invisible wall bump, no message.
- Optional slight downhill acceleration and uphill drag, tuned very low. It should be felt, not noticed.

### 5.2 Petals

- Player is one lead petal. Blooming a flower spawns a petal that flies to join the trail.
- Trail follows a **ring buffer of the lead petal's recent positions** (store ~4 seconds at fixed timestep). Petal *i* samples the path at `t - i * PETAL_SPACING`, then offsets by a per-petal noise-driven swirl so the trail is a loose ribbon, not a rigid snake.
- Each petal has its own slow tumble rotation and a colour sampled from the flower it came from.
- Cap at `MAX_PETALS` (default 120). Beyond the cap, new blooms still play their chime and still count for progression, but recycle the oldest petal. The player never sees a "full" state.
- Petals are lost only as a cosmetic event in specific scripted moments (not used in v0.1).

### 5.3 Blooming

- Each flower has a `bloomRadius`. Entering it triggers: petal spawn, chime (§9.2), a burst of the flower's colour, a small vitality splat (§5.4), and the flower's own open animation.
- Flowers exist as instanced geometry with a per-instance `bloomState` (0→1) animated in the shader. Blooming is a uniform buffer update, not a mesh swap.
- **Cluster logic:** flowers belong to named clusters in the level definition. When a cluster reaches 100% bloomed, it fires an `onComplete` event (see §7.3).

### 5.4 The vitality field — the key technical idea

This is how "restoring life to the land" works without hand-authoring two versions of every asset.

Maintain a single-channel texture (`VITALITY_RES`, default 512×512) mapped across the level's XZ bounds. Value 0 = dead, 1 = alive.

- Blooming a flower **splats** a soft radial gradient into it (additive, clamped).
- Cluster completion events splat larger shapes — a spline sweep, a full region flood animated over 2–3 seconds.
- The grass, terrain, and foliage shaders all sample this texture and use it to lerp:
  - grass colour: `mix(deadColour, aliveColour, vitality)`
  - grass height: dead grass is shorter and stiffer
  - terrain albedo: grey-brown → green
  - ambient particle spawn rate: pollen motes only appear where vitality is high

The result: colour spreads outward from the player like ink in water, for free, with one texture and no per-object state. It also makes an elegant progress readout — `sum(vitality) / area` is the level's completion percentage, computed by mipmapping the texture down to 1×1 rather than by CPU counting.

### 5.5 Camera

- Chase camera positioned behind the velocity vector at `CAM_DISTANCE`, spring-damped on both position and look target. Damping is deliberately loose — the camera lags, which sells the speed.
- FOV lerps from `FOV_BASE` (60°) to `FOV_FAST` (78°) with speed.
- Slight roll into turns (`CAM_ROLL_K`, max ~8°). Subtle. This is a common overreach.
- **Scripted attention beats.** On cluster completion, the camera eases to frame the consequence (the gate opening, the field greening) for ~2 seconds, then returns control. This replaces the tutorial and the HUD, so it has to be implemented well. Player input during a beat is buffered, not dropped.
- Reduced-motion preference: disable roll and FOV shift, shorten attention beats.

### 5.6 Level completion

A slow vertical vortex of wind, petals, and light marks the exit — visible from a distance across the level as a soft column, so it functions as a landmark. Entering it fades to the hub.

---

## 6. Environment systems

### 6.1 Terrain

- Heightfield generated at load from layered simplex noise, seeded per level, plus a set of authored **shaping splines** in the level JSON (a valley here, a ridge there) that modulate the noise. This gives authored composition without shipping a heightmap.
- Mesh: chunked grid, ~64×64 verts per chunk, three LOD levels by distance.
- Shading: mostly flat/diffuse with a wide wrap term. Slope-based blend between grass, dirt, and rock. Vitality-driven colour (§5.4).

### 6.2 Grass — the hero system

The single largest technical risk and the thing most responsible for whether this reads as *Flower*.

**Approach:** GPU instancing via `THREE.InstancedMesh`, one blade mesh instanced per chunk.

- Blade geometry: 5 segments, 11 vertices, tapered, curved. Not a quad with a texture — actual geometry, because silhouette matters at these camera distances.
- Placement: per-chunk blue-noise scatter, position/rotation/height/colour jitter packed into instance attributes. Blade positions snap to terrain height at build time.
- **LOD rings:** full density within 25 m, half density to 60 m, quarter to 120 m, beyond that the terrain shader fakes it with a noise-modulated colour and a horizon "fuzz" card. Chunks are frustum-culled and only rebuilt when the player crosses a chunk boundary.
- Target counts by tier: desktop-high 120k visible blades, desktop-low 45k, tablet 20k.

**Blade shader (vertex):**

1. Base bend by height along the blade (blades curve naturally, they're not straight).
2. Wind: two scrolling 2D noise layers at different frequencies and amplitudes, sampled at world XZ, driving bend direction and magnitude. Gust waves should be *visible as waves crossing the field* — this is what makes wind legible.
3. Player deflection: blades within `DEFLECT_RADIUS` of the player bend away radially, falling off smoothly, with a short recovery lag so the player leaves a temporary wake through the grass.
4. Vitality sample: modulates height and colour.
5. View-space widening for blades edge-on to the camera, so the field doesn't sparkle at distance.

**Blade shader (fragment):** base→tip colour ramp, root darkening for fake AO, low-frequency Perlin patchiness so the field isn't uniform, and a translucency term when the sun is behind the blade. That backlit rim is a large part of the look.

### 6.3 Flowers

- Three or four species per dream, each a distinct colour and a distinct musical scale degree.
- Instanced. Bloom animation driven by a per-instance state uniform: petals unfurl, stem straightens, a brief emissive pulse.
- Placement is **authored, not random**. Flower placement is the level design — it's the only signage the game has. Lines of flowers are the arrows.

### 6.4 Sky and atmosphere

- Gradient skydome driven by a small palette definition per dream (zenith, horizon, sun colour, sun position). No HDRI files.
- Volumetric-ish clouds: 2–3 layers of large scrolling billboard cards with soft noise alpha. Cheap, effective, and they sell scale.
- Distance fog matched to the horizon colour, plus a subtle aerial-perspective tint.
- Ambient particles: pollen motes and drifting seeds near the player, spawn-weighted by vitality. Density scales with speed.

### 6.5 Post-processing

Keep it restrained. Bloom (threshold high, radius wide, intensity low), per-dream colour grading via a small procedural LUT, and a soft vignette. **No** motion blur, **no** depth of field, **no** chromatic aberration in v0.1 — they cost frames and cheapen the look.

---

## 7. Level design

### 7.1 Dream 1 spec (v0.1)

Gentle rolling meadow, mid-morning light, warm greens and a wide pale-blue sky. Roughly 500 m × 500 m playable.

**Section A — Learning to fly.** Open field, one long arcing line of ~15 flowers that curves gently upward. Teaches: follow the flowers, blooming feels good, you get faster. No gate. Ends when the line is bloomed, which greens the immediate basin and grows the flowers of Section B on a hillside above.

**Section B — Altitude and cluster.** A hillside with three distinct clusters at increasing heights. Completing all three triggers an attention beat: the far ridge greens and a stand of dead trees on it revives. Teaches: clusters have consequences you can see at distance.

**Section C — The reveal.** Fly over the revived ridge into a wide bowl valley, fully grey. Dense flowers throughout. Blooming progressively floods the bowl with colour. At ~80% vitality the exit vortex forms at the far end.

**Hidden flowers:** three, placed off the guided path — behind the Section B hillside, inside the dead-tree stand, and beneath an overhang in the bowl. Rewarded with a distinct chime and a permanent extra petal on the hub windowsill plant.

### 7.2 Authoring format

Levels are JSON, hand-editable, hot-reloaded in dev:

```jsonc
{
  "id": "dream-01",
  "seed": 20260803,
  "bounds": { "min": [-250, -250], "max": [250, 250] },
  "terrain": {
    "octaves": [ /* freq/amp pairs */ ],
    "splines": [ { "type": "valley", "points": [...], "width": 40, "depth": 12 } ]
  },
  "palette": "meadow-morning",
  "spawn": { "position": [-200, 18, -180], "heading": 45 },
  "clusters": [
    {
      "id": "A-line",
      "flowers": [ { "pos": [...], "species": "pink" } ],
      "onComplete": [
        { "type": "vitality-flood", "region": "basin-a", "duration": 2.5 },
        { "type": "grow-cluster", "target": "B-1" },
        { "type": "camera-beat", "lookAt": [...], "duration": 2.0 }
      ]
    }
  ],
  "props": [ { "type": "dead-tree", "pos": [...], "cluster": "B-ridge" } ],
  "exit": { "pos": [...], "requires": { "vitality": 0.8 } }
}
```

### 7.3 Event types

`vitality-flood` · `grow-cluster` · `revive-props` · `camera-beat` · `audio-layer-in` · `spawn-exit` · `wind-gust`

Keep this list short. Every new event type is a new thing to tune and a new way for the level to feel scripted.

### 7.4 The placement tool

Flower placement is the level design and the game's only signage, so it gets authored by hand, in-engine, at flight speed. The tool is the **first deliverable of Phase 3** and everything else in that phase depends on it.

Dev-only, activated with `?edit=1`. Stripped from production builds.

**Split of responsibilities:** the tool authors *geometry* — flower positions, cluster membership, props, spawn, exit. It does **not** author *events*. There are only a handful of `onComplete` blocks per level and they're clearer hand-written in JSON afterward. Don't build event UI.

| Key | Action |
|---|---|
| `1`–`4` | Select flower species |
| `F` | Drop flower at the terrain point under the cursor |
| `Shift` + drag | Paint a line of flowers along the dragged path, evenly spaced. This is the primary tool — lines of flowers are how the game points. |
| `[` / `]` | Decrease / increase line spacing |
| `C` | Open a new cluster. Flowers dropped while open join it. `C` again closes it. |
| `P` | Place prop (cycle type with `Tab`) |
| `S` | Set spawn point and heading to current camera |
| `X` | Set exit vortex position |
| `Backspace` | Undo last placement |
| `Ctrl+S` | Save |

**Saving writes to disk, not to a download.** A small Vite dev-server plugin exposes a POST endpoint that writes `src/levels/dream-01.json` directly. The file then hot-reloads and lives in git. Downloading files and moving them by hand is exactly the workflow we're trying to kill.

**Overlay:** current species swatch, open cluster name and its flower count, total flower count, current line spacing, and unsaved-changes indicator. Nothing else.

The tool loads the existing level JSON on start, so authoring is iterative — fly, place, save, play, adjust.

---

## 8. Controls

No control tutorial. A brief, fading glyph on first load, then never again.

| Input | Steer | Boost |
|---|---|---|
| Mouse | Cursor offset from screen centre maps to pitch/yaw. Deadzone in the middle. | Hold left button |
| Keyboard | WASD / arrows | Space |
| Gamepad | Left stick | Right trigger / A |
| Touch | Drag anywhere | Second finger, or drag past a threshold |
| Device tilt (opt-in) | Device orientation, calibrated on start | Tap |

Pointer lock is **off** by default — it traps people and breaks the calm. Offer it as a toggle.

Device tilt is a nod to the original's Sixaxis controls. It's a nice touch on tablet but should never be the only option, and it needs an explicit permission prompt on iOS.

---

## 9. Audio

All synthesised at runtime with the Web Audio API. Zero audio files. This solves the copyright question, keeps the payload tiny, and is the only practical way to get music that responds to play this tightly.

### 9.1 Architecture

```
AudioEngine
├── MusicBed      — 4–6 layered generative pad/arp voices, gain-automated
├── BloomVoices   — polyphonic pluck/bell synth, one voice per bloom
├── WindLayer     — filtered noise, cutoff + gain driven by speed
└── AmbienceLayer — sparse birds/insects, spatialised, gated by vitality
```

### 9.2 Bloom chimes

- Each dream defines a scale (Dream 1: D major pentatonic) and each flower species maps to a scale degree.
- A bloom triggers a short plucked tone: sine + triangle, fast attack, 1.5 s exponential decay, gentle lowpass, light reverb send. Detune ±8 cents randomly so repeats aren't mechanical.
- Rapid consecutive blooms should arpeggiate pleasantly, never clash. Because everything is in-scale, this is free.
- Blooms are panned by screen-space X position of the flower.

### 9.3 Adaptive music bed

- Layer count is a function of `petalCount`: 1 layer at start, adding a voice roughly every 15 petals up to 5.
- Overall brightness (a shared lowpass cutoff) tracks level vitality.
- Section transitions crossfade over 4 s. Cluster completion triggers a swell.
- Everything modal, no dominant-tonic resolution, so it can loop indefinitely without feeling like it's asking for something.

### 9.4 Wind

Pink noise → resonant lowpass. Cutoff and gain track speed. This is doing a lot of the perceptual work for the flight feel — budget real tuning time.

**Audio must start muted** and unlock on first user gesture, per browser autoplay policy. A single unobtrusive speaker glyph is the only persistent UI element in the game.

---

## 10. Technical architecture

### 10.1 Stack

- **Three.js** (latest stable), **TypeScript**, **Vite**. Locked.
- **Vanilla Three, not React Three Fiber.** Locked. One continuous scene, heavy per-frame uniform and instance-buffer work, almost no UI — the reconciler would sit directly in the hot path. No React anywhere in the project.
- No physics engine. The flight model is 40 lines of vector math.
- `simplex-noise` for noise. `tweakpane` for a dev-only tuning panel, tree-shaken out of production builds.
- Deploy to GitHub Pages via Actions. Set `base: '/<repo-name>/'` in `vite.config.ts` — this bites everyone once.

### 10.2 Module layout

```
src/
├── main.ts                 entry, canvas, loop
├── config/
│   ├── tuning.ts           ALL feel constants, single file, heavily commented
│   └── palettes.ts         per-dream colour definitions
├── core/
│   ├── Loop.ts             fixed-step update + interpolated render
│   ├── Input.ts            unified input → { desiredDirection, boost }
│   └── State.ts            game state machine, save/load
├── player/
│   ├── WindController.ts   flight model
│   ├── PetalTrail.ts       ring buffer + instanced petals
│   └── ChaseCamera.ts
├── world/
│   ├── Terrain.ts
│   ├── GrassField.ts       chunking, LOD, instance buffers
│   ├── VitalityField.ts    render target, splatting, mip readback
│   ├── FlowerField.ts
│   ├── Props.ts
│   └── Sky.ts
├── level/
│   ├── LevelLoader.ts
│   ├── ClusterSystem.ts    bloom tracking, event dispatch
│   └── EventRunner.ts
├── audio/
│   ├── AudioEngine.ts
│   ├── BloomVoices.ts
│   └── MusicBed.ts
├── render/
│   ├── PostStack.ts
│   └── shaders/            .glsl files, imported as strings
├── hub/
│   └── Windowsill.ts       (v1.0)
└── levels/
    └── dream-01.json
```

### 10.3 Performance

| Tier | Detection | Grass blades | Shadows | Post | Target |
|---|---|---|---|---|---|
| High | Desktop, >1M px, no perf drop in 3 s probe | 120k | Cascaded, 2 splits | Full | 60 fps |
| Medium | Auto-demote on sustained <50 fps | 45k | Single, near only | Bloom only | 60 fps |
| Low | Mobile UA or demoted twice | 20k | None (baked AO term) | None | 30 fps |

Demotion is automatic and silent, measured over a rolling 3-second window, and it only ever goes down during a session. A manual quality override lives in the pause panel.

Hard rules:
- Zero allocation in the frame loop. Pre-allocate all vectors, pool all particles.
- One draw call per grass chunk per LOD ring. If the profiler shows hundreds of grass draw calls, the chunking is wrong.
- Fixed timestep (60 Hz) for simulation, interpolated for render, so feel doesn't change with framerate.

### 10.4 Accessibility

- `prefers-reduced-motion` respected: no camera roll, no FOV shift, reduced particle density, shortened beats.
- Full keyboard control.
- Adjustable master, music, and SFX gain.
- A "no auto-boost" toggle for anyone who can't hold a button continuously — plus a boost-lock toggle.
- Photosensitivity: no flashing above 3 Hz anywhere, including the bloom bursts.

---

## 11. Non-goals for v0.1

Explicitly out of scope, listed so they don't creep in: multiplayer, level editor UI, VR, achievements, cloud saves, procedurally infinite levels, a title screen with a menu tree, seasons, day/night cycle, water simulation, and any hazard or damage system.

---

## 12. Build plan

Each phase ends with something playable. Do not start a phase before the previous phase's acceptance criteria pass.

### Phase 0 — Flight feel (est. the most important phase)

Flat grey plane, a coloured cone for the player, chase camera, all input methods, tuning panel wired to every constant in `tuning.ts`.

**Acceptance:** Patrick can fly around for two minutes and find it pleasant with no other content on screen. If this isn't true, iterate here — do not proceed. Everything else is decoration on this.

### Phase 1 — Terrain and grass

Heightfield, chunking, instanced blade system, wind shader, LOD rings, player deflection.

**Acceptance:** 120k blades at 60 fps on the target desktop machine. Gust waves visibly travel across the field. Flying low leaves a wake.

### Phase 2 — Petals and blooming

Petal trail, flower instancing, bloom animation, vitality field with splatting, grass and terrain reading vitality.

**Acceptance:** Blooming a line of flowers visibly spreads green outward and the trail grows and accelerates convincingly.

### Phase 3a — Placement tool

The tool from §7.4, plus the JSON loader it saves to. Ships before any level content exists.

**Acceptance:** Patrick can fly the empty terrain, paint a line of thirty flowers along a ridge, close it as a cluster, save, reload, and see it persist.

### Phase 3b — Level and events

Cluster system, event runner, camera attention beats, exit vortex. Then Patrick authors Dream 1 with the tool and hand-writes the `onComplete` blocks.

**Acceptance:** A first-time player finishes Dream 1 without instructions and without getting lost. Test this with an actual person who hasn't seen the build.

### Phase 4 — Audio

Full engine, bloom chimes, adaptive bed, wind layer.

**Acceptance:** Playing with sound on is meaningfully better than with it off, and blooming rapidly sounds musical rather than chaotic.

### Phase 5 — Art pass

Sky, clouds, fog, post stack, palette tuning, particles, prop art.

**Acceptance:** A still frame from the middle of the level looks like something worth screenshotting.

### Phase 6 — Shell and ship

Loading sequence, pause panel, audio unlock, quality tiers, reduced motion, GitHub Pages deploy.

### Phase 7+ — v1.0

Windowsill hub, hidden flowers, Dreams 2 and 3.

---

## 13. Decisions

### Resolved

| Decision | Choice |
|---|---|
| Framework | Vanilla Three.js. No React. |
| Language | TypeScript, strict mode. |
| Level authoring | In-engine placement tool (§7.4), composed by hand. |

### Still open — not blocking Phase 0

4. **Grass ambition.** 120k blades is aggressive for the web. The alternative is targeting 50k and leaning harder on the horizon fake. Decide at the start of Phase 1, once Phase 0 has told us what frame budget the flight model leaves.
5. **Does the vertical slice need the hub?** Deferred to v1.0. The windowsill is a large part of the original's emotional framing, so there's a case for pulling it forward — but it's a whole second scene, and the slice's job is to prove the flying.
6. **Working title.** *Windborne* is a placeholder.

---

## Appendix A — Feel checklist

The subjective criteria that no test can cover. Review against these at the end of every phase.

- Does turning feel like a current changing direction, or like moving a cursor?
- Can you tell which way the wind is blowing without looking at the petals?
- Does the camera make you feel fast when you're fast?
- Does blooming a flower feel like a small gift?
- Is there a moment where you stop trying to progress and just fly?
- Can you get lost? (You shouldn't be able to, for more than about fifteen seconds.)
- Does the silence between musical events feel comfortable or empty?

## Appendix B — Sources consulted

thatgamecompany's own description of the game; Wikipedia's *Flower (video game)* entry; GameSpot's PS4-era review; Gamasutra/Game Developer interviews with Jenova Chen, Kellee Santiago, and composer Vincent Diamante; TV Tropes' level-by-level notes; PlayStation trophy guides for hidden-flower placement and level structure; Engadget on the PS3 grass count; GPUOpen and Ghost of Tsushima GDC material on procedural grass rendering technique.
