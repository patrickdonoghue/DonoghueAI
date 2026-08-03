/**
 * tuning.ts — every constant that affects how Windborne feels.
 *
 * These are starting values, not answers. They're chosen to be in the right
 * order of magnitude and internally consistent, so Phase 0 begins somewhere
 * plausible rather than somewhere random. Expect to change most of them.
 *
 * Units: metres, seconds, radians. Angles in the comments are in degrees for
 * readability; the code converts.
 *
 * Every value has a note on what raising or lowering it does. If you add a
 * constant, add the note.
 */

const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------
// FLIGHT
// ---------------------------------------------------------------------------

export const FLIGHT = {
  /** Cruising speed with no boost and no petals. ~14 m/s is a fast bicycle —
   *  quick enough to feel like weather, slow enough to look at things.
   *  Higher: more exhilarating, harder to place yourself in the landscape. */
  BASE_SPEED: 14.0,

  /** Boost multiplier at full input. 0.9 means boost gets you to ~26.6 m/s.
   *  Higher: bigger gear change, more risk of losing the calm. */
  BOOST_GAIN: 0.9,

  /** Speed gain per petal, applied as 1 + K * sqrt(petalCount).
   *  At 25 petals: 1.23x. At 100: 1.45x. Square root so the late game
   *  doesn't become uncontrollable.
   *  Higher: collecting feels more powerful, but the level's pacing
   *  compresses toward the end. */
  PETAL_SPEED_K: 0.045,

  /** Time constant for speeding up. Lower is snappier.
   *  0.8s means boost takes about a second to fully arrive. */
  ACCEL_TAU: 0.8,

  /** Time constant for slowing down. Deliberately longer than ACCEL_TAU —
   *  wind carries momentum. Higher: more glide, less control. */
  DECEL_TAU: 1.4,

  /** How fast the velocity vector can rotate toward the input direction,
   *  at BASE_SPEED. 0.85 rad/s ≈ 49°/s.
   *  This single number does more for the "I am a current, not a cursor"
   *  feeling than anything else in this file. Brought down twice now —
   *  1.6 then 1.2 both still chased every small input change too eagerly
   *  instead of carrying through a turn. Combined with the INPUT changes
   *  below, this is the third and biggest pass at the same complaint.
   *  Higher: responsive, arcade, cheap. Lower: heavy, majestic, frustrating. */
  TURN_RATE: 0.85,

  /** Turn rate at maximum speed. Turning gets harder as you go faster,
   *  which is both physical and good for pacing. Interpolated linearly
   *  between BASE_SPEED and max. */
  TURN_RATE_AT_MAX: 0.5,

  /** Hard limit on pitch, so the player can never end up inverted or
   *  staring at the sky with no horizon reference. ±70°. */
  PITCH_LIMIT: 70 * DEG,

  /** How close to the ground you can get before the game pushes you up.
   *  Grass is 0.55m tall, so 1.2m means you graze the tops — which is the
   *  best-feeling place to fly and should be encouraged.
   *  Lower: more thrilling, more likely to clip through terrain detail. */
  MIN_ALTITUDE: 1.2,

  /** Upward acceleration per metre below MIN_ALTITUDE. This is the
   *  "you cannot crash" system. Stiff enough to be reliable, soft enough
   *  that it reads as a cushion of air rather than a wall. */
  ALTITUDE_PUSH_K: 18.0,

  /** Soft ceiling. Above this a gentle downward force applies. Keeps the
   *  player inside the composition — from 200m up, a beautiful level looks
   *  like a texture. */
  MAX_ALTITUDE: 120.0,
  ALTITUDE_CEILING_K: 6.0,

  /** Distance from the level bounds where the turn-back force begins.
   *  Accompanied by a visible gust of dust and leaves — the player should
   *  understand they were turned around, not that the game glitched. */
  BOUNDARY_MARGIN: 40.0,
  BOUNDARY_TURN_K: 0.9,

  /** Slight acceleration downhill, drag uphill. Should be felt and not
   *  noticed. Set to 0 to disable while tuning other things. */
  SLOPE_ASSIST: 0.15,
} as const;

// ---------------------------------------------------------------------------
// INPUT
// ---------------------------------------------------------------------------

export const INPUT = {
  /** Fraction of the screen's half-height at the centre where mouse input
   *  reads as neutral. Without this, the player can never fly straight.
   *  Raised from 0.06 — that let tiny, near-unavoidable cursor tremor
   *  right around centre register as steering input. */
  MOUSE_DEADZONE: 0.1,

  /** How far from centre the cursor must be for maximum steering input,
   *  as a fraction of half-height. Raised from 0.55 — that reached full
   *  deflection within little more than half the screen's half-height,
   *  a steep curve where small mouse movements near centre produced
   *  outsized input changes. 0.8 flattens that curve considerably; you
   *  now need a deliberate, close-to-full-height movement for max input. */
  MOUSE_FULL_DEFLECTION: 0.8,

  /** Input smoothing time constant. Raised twice now — 0.08 relied on
   *  TURN_RATE alone to absorb jittery raw input, and 0.18 still wasn't
   *  enough. 0.35 filters out noticeably more of the small, fast
   *  cursor/stick movements before they ever reach the flight model.
   *  Higher: smoother, but steering starts to feel delayed/laggy — if
   *  input starts to feel sluggish rather than twitchy, this is the
   *  first one to bring back down. */
  SMOOTHING_TAU: 0.35,

  GAMEPAD_DEADZONE: 0.12,

  /** Touch drag distance in CSS pixels for full deflection. */
  TOUCH_FULL_DEFLECTION: 140,

  /** Touch drag distance past full deflection at which a single finger
   *  alone counts as boosting (the alternative to a second finger).
   *  Higher: harder to boost by accident while just steering hard. */
  TOUCH_BOOST_DRAG: 220,

  /** How far off centre-forward full steering deflection aims, in world
   *  units at 1m distance (effectively a tangent of the steering cone).
   *  This is the target the flight model's TURN_RATE then chases toward —
   *  it does not itself control turn speed. Brought down twice now, from
   *  1.1 to 0.85 to 0.55, so a full-deflection input doesn't demand as
   *  sharp a correction.
   *  Higher: full deflection points further from where you're already
   *  headed, so the plateau at max turn rate is reached sooner. */
  STEER_SPAN: 0.55,

  /** Device tilt calibration: degrees of device tilt for full deflection,
   *  measured from the orientation at calibration time. */
  TILT_FULL_DEFLECTION: 20,
} as const;

// ---------------------------------------------------------------------------
// PETALS
// ---------------------------------------------------------------------------

export const PETALS = {
  /** Beyond this, blooming still chimes and still counts, but recycles the
   *  oldest petal. The player never sees a "full" state. */
  MAX_PETALS: 120,

  /** Seconds of path history stored, at the 60 Hz fixed step.
   *  5s × 60 = 300 samples. Must exceed MAX_PETALS × PETAL_SPACING. */
  PATH_BUFFER_SECONDS: 5.0,

  /** Time offset between consecutive petals along the path.
   *  120 petals × 0.035s = 4.2s of trail.
   *  Higher: a longer, more dramatic ribbon that lags further behind.
   *  Lower: a tight cluster that reads more like a single object. */
  PETAL_SPACING: 0.035,

  /** Amplitude of the per-petal noise offset from the path, in metres.
   *  This is what makes the trail a loose ribbon instead of a rigid snake.
   *  Higher: more chaotic and organic, less legible as a trail. */
  SWIRL_AMPLITUDE: 0.8,
  SWIRL_FREQUENCY: 0.35,

  /** Petal quad size in metres. */
  SIZE: 0.18,
  SIZE_JITTER: 0.25,

  /** Per-petal tumble, randomised in this range (rad/s). */
  TUMBLE_RATE_MIN: 0.6,
  TUMBLE_RATE_MAX: 1.4,

  /** Time for a newly bloomed petal to fly from the flower to its slot
   *  in the trail. Short enough to feel connected to the bloom. */
  JOIN_DURATION: 0.45,
} as const;

// ---------------------------------------------------------------------------
// CAMERA
// ---------------------------------------------------------------------------

export const CAMERA = {
  /** Distance behind the lead petal. Close enough to feel the speed,
   *  far enough to see the trail you've built. */
  DISTANCE: 5.5,
  HEIGHT_OFFSET: 1.2,

  /** Spring damping, 0–1 per frame at 60 Hz. Lower = looser = laggier.
   *  The lag is deliberate: it's most of why fast feels fast.
   *  Look damping is looser than position damping so the camera swings
   *  around into turns rather than snapping. */
  POSITION_DAMPING: 0.12,
  LOOK_DAMPING: 0.08,

  /** FOV widens with speed. 60° at rest, 78° flat out.
   *  Higher spread: more visceral, more distortion at the edges. */
  FOV_BASE: 60,
  FOV_FAST: 78,
  FOV_TAU: 0.5,

  /** Roll into turns. 8° maximum. This is the most commonly overdone
   *  camera effect in the genre — if you notice it, it's too much. */
  ROLL_MAX: 8 * DEG,
  ROLL_DAMPING: 0.06,

  /** Scripted attention beats: how long the camera holds on a consequence
   *  before returning control. Player input during a beat is buffered,
   *  not dropped. */
  BEAT_DURATION_DEFAULT: 2.0,
  BEAT_BLEND_IN: 0.5,
  BEAT_BLEND_OUT: 0.7,

  NEAR: 0.1,
  FAR: 500,
} as const;

// ---------------------------------------------------------------------------
// TERRAIN
// ---------------------------------------------------------------------------

export const TERRAIN = {
  /** World size of a terrain mesh chunk. Independent of GRASS.CHUNK_SIZE —
   *  terrain chunks are much bigger since the mesh itself doesn't need
   *  fine-grained culling the way individual grass blades do. */
  CHUNK_SIZE: 50.0,

  /** Vertices per side at each LOD tier. The PRD targets ~64×64 for the
   *  nearest tier; 65 (not 64) so there are an even 64 quads per side. */
  RESOLUTION_NEAR: 65,
  RESOLUTION_MID: 33,
  RESOLUTION_FAR: 17,

  /** Distance bands (metres, from chunk centre to camera) that select the
   *  resolution tiers above. Phase 1 assigns a chunk's tier once at load,
   *  from its distance to the centre of the (currently small, bounded)
   *  test level rather than re-deriving it every frame from the player —
   *  simple, and fine while there's one small level. Revisit if/when
   *  Phase 3+ levels get large enough that this stops being a good
   *  approximation of "near the player." */
  LOD_NEAR_DISTANCE: 120.0,
  LOD_MID_DISTANCE: 260.0,

  /** Slope blend range for the grass/dirt/rock colour mix, expressed as
   *  dot(normal, up). 1.0 is flat ground, 0.0 is a vertical cliff.
   *  Above SLOPE_GRASS_MAX: pure grass colour. Below SLOPE_ROCK_MIN: pure
   *  rock. Between: linear blend, with dirt as the midpoint tint. */
  SLOPE_GRASS_MAX: 0.92,
  SLOPE_ROCK_MIN: 0.55,
} as const;

// ---------------------------------------------------------------------------
// GRASS
// ---------------------------------------------------------------------------

export const GRASS = {
  /** Blade dimensions in metres. Dead grass is shorter and stiffer. */
  HEIGHT_ALIVE: 0.55,
  HEIGHT_DEAD: 0.28,
  HEIGHT_JITTER: 0.3,

  /** Raised from 0.035 — at the chase camera's normal cruising altitude
   *  (several metres up, looking down at a shallow-to-moderate angle),
   *  a real-grass-width blade foreshortens into a fraction of a pixel
   *  and disappears into the terrain's own grass-green colour. This is
   *  the single most direct lever on "does grass read as grass from
   *  altitude, not just when grazing the tops."
   *  Higher: reads better from up high, more visibly like thin ribbons
   *  than blades when actually grazing the tops. */
  WIDTH: 0.06,

  /** Segments per blade. 5 gives a convincing curve; 3 looks like a shard.
   *  Each segment is 2 verts, plus the tip: 11 vertices, 9 triangles. */
  SEGMENTS: 5,

  /** Static natural lean baked into every blade's rest pose, as a fraction
   *  of its own height. Separate from wind — this is "blades aren't
   *  straight," not "blades are swaying."
   *  Higher: shaggier, more windswept-looking even at rest. */
  CURVE_AMOUNT: 0.18,

  /** World size of a grass chunk. Chunks are the unit of culling and
   *  rebuild, so smaller means finer culling but more draw calls. */
  CHUNK_SIZE: 8.0,

  /** LOD rings: [outerRadius (m), blades per m²].
   *  Densities fall off fast because distant blades cover fewer pixels.
   *  These totals target roughly 120k visible blades:
   *    ring 0: π·20²      × 32   ≈  40k
   *    ring 1: π(50²−20²) × 8    ≈  48k
   *    ring 2: π(100²−50²)× 1.4  ≈  33k
   *  Beyond ring 2 the terrain shader fakes grass with noise-modulated
   *  colour plus a horizon fuzz card. */
  LOD_RINGS: [
    { radius: 20, density: 32.0 },
    { radius: 50, density: 8.0 },
    { radius: 100, density: 1.4 },
  ],

  /** Distance (m) before a ring's outer radius where blades start
   *  shrinking toward their root, reaching nothing exactly at the edge.
   *  Without this, a grass chunk crossing between rings — or leaving
   *  range entirely — pops at full size the instant GrassField rebuilds,
   *  instead of fading out first.
   *  Higher: smoother, but the fade becomes noticeable as its own ring
   *  of shorter grass. Lower: less shrinking distance, more of a pop. */
  EDGE_FADE_BAND: 6.0,

  /** Widen blades the camera sees mostly edge-on — either because a
   *  blade's own width axis points near-straight at the camera, or
   *  because the camera is looking steeply down and every blade's height
   *  (its main visible extent from the side) has foreshortened away.
   *  Without this, grass sparkles at distance and reads as flat ground
   *  from altitude, since only WIDTH is left contributing coverage in
   *  both cases. Raised from 0.6 alongside the altitude-visibility fix
   *  above — this pulls more weight now that the top-down case is
   *  actually covered (see grass.vert.glsl). */
  VIEW_WIDEN: 0.9,

  /** Fake ambient occlusion: how much to darken the blade toward its root. */
  ROOT_DARKEN: 0.45,

  /** Low-frequency Perlin patchiness so the field isn't a uniform carpet.
   *  Scale is in world units; strength is a 0–1 colour multiplier range. */
  PATCH_SCALE: 0.06,
  PATCH_STRENGTH: 0.25,

  /** Translucency when the sun is behind the blade. A large part of why
   *  a grass field looks alive rather than plastic. */
  BACKLIGHT_STRENGTH: 0.8,
  BACKLIGHT_POWER: 3.0,
} as const;

// ---------------------------------------------------------------------------
// WIND
// ---------------------------------------------------------------------------

export const WIND = {
  /** Prevailing direction, XZ, normalised at load. */
  DIRECTION: [0.85, 0.53] as const,

  /** Baseline bend as a fraction of blade height. */
  BASE_STRENGTH: 0.35,

  /** Two noise layers. Frequency is in cycles per metre, speed in m/s.
   *  Layer 1 is the broad sway, layer 2 the fine chatter. */
  LAYER_1: { frequency: 0.06, amplitude: 0.6, speed: 2.2 },
  LAYER_2: { frequency: 0.28, amplitude: 0.3, speed: 5.0 },

  /** Big gust waves that visibly travel across the field. These are what
   *  make wind legible at a distance, and they are the difference between
   *  "the grass is animated" and "there is weather here".
   *  Do not tune this down to save frames. */
  GUST: { frequency: 0.015, amplitude: 0.5, speed: 8.0 },

  /** Player wake: blades within this radius bend away radially. */
  DEFLECT_RADIUS: 3.5,
  DEFLECT_STRENGTH: 1.0,

  /** How long deflected grass takes to stand back up. The lag is what
   *  makes it read as a wake rather than a moving hole. */
  DEFLECT_RECOVERY_TAU: 0.9,
} as const;

// ---------------------------------------------------------------------------
// BLOOMING & VITALITY
// ---------------------------------------------------------------------------

export const BLOOM = {
  /** How close you must pass to bloom a flower. Generous on purpose —
   *  missing a flower you aimed at is the single most annoying thing
   *  this game could do. */
  RADIUS: 2.2,

  /** Flower opening animation. */
  ANIM_DURATION: 0.6,

  /** Brief emissive pulse on bloom. Keep well under the 3 Hz
   *  photosensitivity limit and low in intensity. */
  FLASH_INTENSITY: 0.6,
  FLASH_DURATION: 0.25,
} as const;

export const VITALITY = {
  /** Resolution of the single-channel field texture covering the level.
   *  512² over a 500m level is ~1m per texel, which is plenty — this is
   *  a soft colour mask, not a collision map. */
  RESOLUTION: 512,

  /** Radius in metres of the soft splat a single bloom writes. */
  SPLAT_RADIUS: 6.0,
  SPLAT_STRENGTH: 0.85,

  /** Falloff exponent. 2.0 is a smooth quadratic edge; higher gives a
   *  harder-edged puddle of colour. */
  SPLAT_FALLOFF: 2.0,

  /** Default duration for a cluster's vitality-flood event. */
  FLOOD_DURATION: 2.5,

  /** How much vitality affects grass height, as a fraction between
   *  HEIGHT_DEAD and HEIGHT_ALIVE. 1.0 = full range. */
  HEIGHT_INFLUENCE: 1.0,
} as const;

// ---------------------------------------------------------------------------
// AUDIO
// ---------------------------------------------------------------------------

export const AUDIO = {
  /** Semitone offsets from the root for the bloom scale.
   *  D major pentatonic: D E F# A B. Everything in scale means rapid
   *  blooms arpeggiate instead of clashing — that's free consonance and
   *  it's the reason to use a pentatonic at all. */
  SCALE_SEMITONES: [0, 2, 4, 7, 9] as const,
  ROOT_MIDI: 62, // D4

  /** Bloom chime envelope. Fast attack, long exponential decay. */
  CHIME_ATTACK: 0.006,
  CHIME_DECAY: 1.5,
  CHIME_PEAK_GAIN: 0.35,

  /** Random detune per chime, in cents. Stops repeated notes sounding
   *  mechanical. */
  CHIME_DETUNE_CENTS: 8,

  /** Cap on simultaneous chime voices. Flying through a dense cluster
   *  should sound like a chord, not like clipping. */
  MAX_CHIME_VOICES: 12,

  /** Music bed gains one layer per this many petals, up to 5 layers. */
  LAYER_PETAL_STEP: 15,
  MAX_MUSIC_LAYERS: 5,

  /** Crossfade time for section transitions. */
  SECTION_CROSSFADE: 4.0,

  /** Wind layer: filtered pink noise. Cutoff and gain track speed
   *  between BASE_SPEED and max. This is doing a lot of the perceptual
   *  work for the flight feel — budget real tuning time here. */
  WIND_CUTOFF_MIN: 240,
  WIND_CUTOFF_MAX: 2400,
  WIND_GAIN_MIN: 0.05,
  WIND_GAIN_MAX: 0.30,
  WIND_RESONANCE: 1.4,

  MASTER_GAIN_DEFAULT: 0.7,
} as const;

// ---------------------------------------------------------------------------
// PARTICLES
// ---------------------------------------------------------------------------

export const PARTICLES = {
  /** Pollen motes near the player. Spawn rate is multiplied by local
   *  vitality, so dead ground is visibly empty of life. */
  POLLEN_MAX: 400,
  POLLEN_SPAWN_RATE: 25,
  POLLEN_RADIUS: 35,
  POLLEN_SIZE: 0.05,
  POLLEN_LIFETIME: 6.0,

  /** Extra particles at speed, so boosting reads as motion even over
   *  featureless terrain. */
  SPEED_SPAWN_MULTIPLIER: 1.8,
} as const;

// ---------------------------------------------------------------------------
// PERFORMANCE
// ---------------------------------------------------------------------------

export const PERF = {
  /** Sustained framerate below this for DEMOTE_WINDOW seconds drops a
   *  quality tier. Silent, automatic, and one-way within a session. */
  DEMOTE_FPS_THRESHOLD: 50,
  DEMOTE_WINDOW: 3.0,

  /** Simulation rate. Render interpolates between steps. */
  FIXED_TIMESTEP: 1 / 60,

  /** Cap on steps per frame, so a long tab-switch stall doesn't produce
   *  a death spiral of catch-up simulation. */
  MAX_STEPS_PER_FRAME: 5,

  /** Blade budgets per tier. Ring densities above scale to hit these. */
  BLADE_BUDGET: { high: 120_000, medium: 45_000, low: 20_000 },

  SHADOW_MAP_SIZE: { high: 2048, medium: 1024, low: 0 },
} as const;

// ---------------------------------------------------------------------------
// POST-PROCESSING
// ---------------------------------------------------------------------------

export const POST = {
  /** Restrained bloom: high threshold, wide radius, low intensity.
   *  It should catch the sky, the backlit grass tips, and the bloom
   *  flashes, and nothing else. */
  BLOOM_THRESHOLD: 0.85,
  BLOOM_RADIUS: 0.6,
  BLOOM_INTENSITY: 0.35,

  VIGNETTE_STRENGTH: 0.25,
  VIGNETTE_SMOOTHNESS: 0.5,

  EXPOSURE: 1.0,
} as const;
