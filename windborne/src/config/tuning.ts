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
  /** Cruising speed with no boost and no petals. The original 14 m/s is a
   *  fast bicycle — quick enough to feel like weather, slow enough to look
   *  at things. Trimmed to 10 at the Phase 2 gate (targeting flowers felt
   *  hard) as a middle path: Patrick proposed halving to 7, but 7 m/s is
   *  jogging pace and risks losing the "you are the wind" feel Phase 0
   *  was accepted on — most of the targeting difficulty is addressed by
   *  the wider BLOOM.RADIUS and bigger flowers instead. Revisit after a
   *  flight at this combination.
   *  Higher: more exhilarating, harder to place yourself in the landscape. */
  BASE_SPEED: 10.0,

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
   *  at BASE_SPEED. 0.55 rad/s ≈ 32°/s.
   *  This single number does more for the "I am a current, not a cursor"
   *  feeling than anything else in this file. Fourth pass now — 1.6, then
   *  1.2, then 0.85 all still felt "very very sensitive." This is the one
   *  hard cap on how fast heading can change no matter what the input
   *  does, so if it's still too sensitive after this, the remaining
   *  culprit is more likely pitch specifically (see STEER_SPAN below)
   *  than this number.
   *  Higher: responsive, arcade, cheap. Lower: heavy, majestic, frustrating. */
  TURN_RATE: 0.55,

  /** Turn rate at maximum speed. Turning gets harder as you go faster,
   *  which is both physical and good for pacing. Interpolated linearly
   *  between BASE_SPEED and max. */
  TURN_RATE_AT_MAX: 0.35,

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
   *  like a texture, and grass in particular stops reading as grass at
   *  all well before that. Brought down from 120 specifically to bound
   *  how far a pitch overcorrection can climb — a backstop for the
   *  sensitivity fix above, not a substitute for it. ALTITUDE_CEILING_K
   *  raised to compensate for the shorter runway to arrest a climb in. */
  MAX_ALTITUDE: 40.0,
  ALTITUDE_CEILING_K: 9.0,

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
   *  as a fraction of half-height. 1.0 means the full deflection point is
   *  the screen edge — as flat as this curve can get; confirmed to help
   *  but not be sufficient on its own, which is why TURN_RATE, STEER_SPAN,
   *  and SMOOTHING_TAU all moved again alongside it. */
  MOUSE_FULL_DEFLECTION: 1.0,

  /** Input smoothing time constant. Third raise now — 0.08 relied on
   *  TURN_RATE alone to absorb jittery raw input, 0.18 and 0.35 both
   *  still felt very sensitive. 0.55 filters out substantially more of
   *  the small, fast cursor/stick movements before they ever reach the
   *  flight model.
   *  Higher: smoother, but steering starts to feel delayed/laggy — if
   *  input starts to feel sluggish rather than twitchy, this is the
   *  first one to bring back down. */
  SMOOTHING_TAU: 0.55,

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
   *  it does not itself control turn speed. Brought down three times now,
   *  from 1.1 to 0.85 to 0.55 to 0.35, so a full-deflection input doesn't
   *  demand as sharp a correction.
   *  Note: this applies equally to yaw and pitch. The worst sensitivity
   *  symptom so far (wild altitude swings) was pitch-driven — if it's
   *  still too sensitive specifically when climbing/diving rather than
   *  turning left/right after this pass, the fix is probably splitting
   *  pitch onto its own (lower) sensitivity rather than lowering this
   *  further, since yaw and pitch are sharing every knob in this file.
   *  Higher: full deflection points further from where you're already
   *  headed, so the plateau at max turn rate is reached sooner. */
  STEER_SPAN: 0.35,

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
// PLAYER LIGHT
// ---------------------------------------------------------------------------

/** A soft glow that travels with the player, brightening grass and terrain
 *  nearby regardless of sun angle or shadow. Not in the PRD — added because
 *  the wrap/floor fixes on grass and terrain lighting have a ceiling (the
 *  base colours' own brightness), and the ground directly around the
 *  player, which is what you're actually looking at most of the time,
 *  benefits from its own light rather than depending entirely on the sun.
 *  Colour reuses the sun's own colour (already available in both shaders)
 *  rather than introducing a new palette entry, so it reads as "catching
 *  warm light" rather than an arbitrary glow. */
export const PLAYER_LIGHT = {
  /** Radius in metres, measured horizontally (XZ) from the player, not
   *  true 3D distance — like a light shining straight down, so it lights
   *  the ground below at any altitude instead of fading out as the player
   *  climbs. Full glow at 0, fading to none by this distance.
   *  Raised from 12 once XZ-only distance made altitude stop competing
   *  with it — at 12 with true 3D distance, ordinary cruising altitude
   *  alone used up most of the radius before it ever reached the ground. */
  RADIUS: 18.0,

  /** Multiplier on the sun's colour at the player's own position. 1.0
   *  roughly doubles the sun's usual maximum contribution right at the
   *  player, which is deliberate — the point is for the immediate area to
   *  always read as clearly lit.
   *  Higher: the player visibly carries its own light. Lower: more
   *  subtle, closer to just softening the nearest shadows. */
  INTENSITY: 0.9,
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

  /** Wide wrap term for terrain lighting (PRD §6.1): a floor on the
   *  diffuse term, so a slope facing squarely away from the sun still
   *  gets this fraction of full sun brightness instead of dropping to
   *  ambient-only. A plain Lambertian max(dot, 0) clips fully-shadowed
   *  ground straight to ambient, which read as near-black once
   *  terrain.aliveGrass got dark enough for grass contrast — there just
   *  wasn't enough ambient light on its own to lift a colour that dark.
   *  Higher: flatter, less contrasty shading. Lower: more dramatic
   *  shadows, but shadowed ground gets darker fast. */
  LIGHT_WRAP: 0.55,
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
   *  Ring 2's radius raised from 100 to 150 — at 100 the edge where real
   *  grass stopped was a visible hard line (fog at 100m is only ~14% of
   *  the way to full strength, nowhere near enough to hide it). 150 pushes
   *  the line out to where fog is doing real work (~32%), and gives the
   *  terrain's noise-modulated fake grass (see Terrain.ts) more room to
   *  hand off smoothly instead of needing to disguise a nearby seam.
   *  These totals now target roughly 175k visible blades:
   *    ring 0: π·32²      × 32   ≈ 103k
   *    ring 1: π(50²−32²) × 8    ≈  37k
   *    ring 2: π(150²−50²)× 1.4  ≈  88k
   *  Beyond ring 2 the terrain shader fakes grass with noise-modulated
   *  colour — see Terrain.ts's fake-grass blend. A full horizon fuzz
   *  card (billboard geometry, per the PRD) is still not built.
   *
   *  Ring 0's radius was 20 until the fresh review traced "grass popping
   *  as I approach the ground" to this ring specifically: EDGE_FADE_BAND
   *  fades symmetrically around EVERY boundary (see its own comment), so
   *  with radius 20 the fade zone [8, 32] ate more than half of ring 0's
   *  own radius — only the inner 8m around the player was ever at full,
   *  unfaded density. That 8m core is a small fraction of the view at
   *  altitude, easy to miss, but dominates the frame once low and close
   *  to the ground, which is exactly when the ongoing fade/unfade across
   *  most of the visible grass reads as popping. Raised to 32 so the
   *  stable core (radius − EDGE_FADE_BAND) is a comfortable 20m instead
   *  of 8m, without touching EDGE_FADE_BAND itself (still sized for the
   *  rebuild-lag error described there, unrelated to this). */
  LOD_RINGS: [
    { radius: 32, density: 32.0 },
    { radius: 50, density: 8.0 },
    { radius: 150, density: 1.4 },
  ],

  /** Distance (m) on EITHER side of a LOD ring boundary (32m, 50m, 150m)
   *  where blades shrink toward their root, reaching nothing exactly at
   *  the boundary. Symmetric, and identical for every ring's material —
   *  a chunk fades the same way whether it's approaching a boundary from
   *  the sparse side or the dense side, so it doesn't matter which ring's
   *  buffer it happens to be sitting in when GrassField's rebuild (which
   *  only fires when the player crosses an 8m grass-chunk boundary, so it
   *  can lag the true crossing by up to ~11m of player movement — worst
   *  case a diagonal crossing of that chunk — finally reassigns it.
   *  Must stay comfortably above that worst-case lag, or a reassignment
   *  can land past the fade zone with no cushioning either side.
   *  Higher: smoother, but the fade becomes noticeable as its own ring
   *  of shorter grass (and eats further into whichever ring's own radius
   *  it borders — see ring 0's own comment for what happens when a ring
   *  is too small relative to this band). Lower: risks the pop coming
   *  back. */
  EDGE_FADE_BAND: 12.0,

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

  /** Wrap/floor term for grass lighting, same idea as TERRAIN.LIGHT_WRAP:
   *  a blade's normal is just local (0,0,1) rotated by that instance's
   *  random yaw, so roughly half of any dense patch faces away from the
   *  sun at any given moment. Without a floor, a plain Lambertian term
   *  sends that whole half to ambient-only, and the field reads as
   *  patchy-dark rather than evenly lit — much more visible here than on
   *  terrain, since real grass dominates most of the close-up view.
   *  Higher: flatter-looking grass. Lower: more per-blade contrast, but
   *  the shadowed half gets dark fast. */
  LIGHT_WRAP: 0.55,

  /** Low-frequency Perlin patchiness so the field isn't a uniform carpet.
   *  Scale is in world units; strength is a 0–1 colour multiplier range. */
  PATCH_SCALE: 0.06,
  PATCH_STRENGTH: 0.25,

  /** Translucency when the sun is behind the blade. A large part of why
   *  a grass field looks alive rather than plastic. */
  BACKLIGHT_STRENGTH: 0.5,
  BACKLIGHT_POWER: 3.0,

  /** Low-frequency noise scale for the terrain's fake-grass tint beyond
   *  ring 2 (see Terrain.ts) — deliberately coarser than PATCH_SCALE.
   *  Up close, patchiness is a per-blade brightness variation; from far
   *  away real grass just reads as broad tonal patches, closer to
   *  cloud-shadow scale than blade scale. */
  HORIZON_PATCH_SCALE: 0.015,
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
   *  Layer 1 is the broad sway, layer 2 the fine chatter.
   *  Layer 2's temporal frequency is speed/wavelength, not speed alone —
   *  at frequency 0.28 (wavelength ~3.6m) the old speed of 5.0 scrolled a
   *  full cycle every ~0.7s, reading as frenetic jitter riding on top of
   *  the slower sway rather than fine chatter. Lowered speed and amplitude
   *  together so it's still there as texture but doesn't dominate. */
  LAYER_1: { frequency: 0.06, amplitude: 0.6, speed: 2.2 },
  LAYER_2: { frequency: 0.28, amplitude: 0.18, speed: 2.5 },

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

export const FLOWERS = {
  /** Flower proportions, metres. Raised 50% across the board at Patrick's
   *  Phase 2 gate feedback ("the flowers are a little hard to find") —
   *  they should still read through colour and number more than
   *  individual size, but a target you can't see isn't a target.
   *  STEM_HEIGHT must clear GRASS.HEIGHT_ALIVE (0.55) or bloomed flowers
   *  vanish into the very grass their own bloom just restored. */
  STEM_HEIGHT: 1.1,
  PETAL_LENGTH: 0.24,
  PETAL_WIDTH: 0.15,
  PETAL_COUNT: 5,
  CENTER_RADIUS: 0.07,

  /** Unbloomed bud: how folded-up the petals sit (radians from horizontal)
   *  and how squashed the stem is. Bloomed values are the open pose.
   *  Wider FOLD_CLOSED reads as a tighter bud. */
  FOLD_CLOSED: 1.35,
  FOLD_OPEN: 0.3,
  STEM_SCALE_CLOSED: 0.55,

  /** How dim an unbloomed bud renders relative to its bloomed colour.
   *  Low enough that a field of buds reads as "asleep", high enough that
   *  buds are still findable against dead grass. Raised from 0.35 with
   *  the size increase — finding a flower is first about seeing it. */
  BUD_DIMMING: 0.5,
} as const;

export const BLOOM = {
  /** How close you must pass to bloom a flower. Generous on purpose —
   *  missing a flower you aimed at is the single most annoying thing
   *  this game could do. Raised from 2.2 at the Phase 2 gate: targeting
   *  felt hard, and widening the hit window attacks that directly
   *  without slowing the flight down to a walk (see BASE_SPEED). */
  RADIUS: 3.2,

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

  /** Radius in metres of the soft splat a single bloom writes. Sized so
   *  that flowers a few metres apart fuse into a continuous ribbon of
   *  life rather than a dotted line. */
  SPLAT_RADIUS: 9.0,
  SPLAT_STRENGTH: 1.0,

  /** Fraction of the radius at FULL strength before falloff begins.
   *  Without a flat core, a quadratic falloff leaves only the exact
   *  centre fully alive and the restored green reads as a faint tint
   *  against the (deliberately pale) dead palette — this was found the
   *  hard way when the first bloom line produced no visible green at
   *  all. The core makes each bloom a solid puddle with a soft rim. */
  SPLAT_CORE: 0.45,

  /** Falloff exponent for the rim beyond SPLAT_CORE. 2.0 is a smooth
   *  quadratic edge; higher gives a harder-edged puddle of colour. */
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
// PROPS — trees and rocks (PRD §6.1/§7.2)
// ---------------------------------------------------------------------------

export const PROPS = {
  /** Trees are the map's landmarks: tall enough to be recognisable from
   *  across the level, which is the whole point (Patrick, authoring
   *  Dream 1: "the landscape needs a few landmarks to know where you
   *  are"). Metres. */
  TREE_HEIGHT: 7.5,
  TREE_HEIGHT_JITTER: 0.35,
  TRUNK_RADIUS: 0.46,
  /** Canopy radius as a fraction of total height. */
  CANOPY_RADIUS: 0.42,
  /** Height up the trunk where the canopy's underside sits, as a
   *  fraction of tree height. Lower means more overlap and a fuller
   *  tree; too high and it reads as a lollipop on a stick. */
  CANOPY_BASE: 0.5,
  /** Vertical squash of the canopy blob — below 1 gives a crown that's
   *  wider than it is tall, which reads more like a tree than an egg. */
  CANOPY_SQUASH: 0.82,
  /** How lumpy the canopy blob is, 0 = smooth ball, 1 = very irregular.
   *  This is the baseline; each SHAPE VARIANT below scales it. */
  CANOPY_LUMPINESS: 0.28,

  /** Distinct base silhouettes per prop type. One shape reused at
   *  assorted scales reads as clones — these give genuinely different
   *  outlines, each a separate draw call (a handful, against a scene
   *  budget measured in tens). Each entry is [lumpiness x, squash x]:
   *  lumpiness multiplies the baseline irregularity, squash multiplies
   *  the vertical proportion (below 1 = broader than tall). */
  CANOPY_VARIANTS: [
    [0.8, 1.12], // tall and fairly smooth — a young, upright crown
    [1.15, 0.92], // the middleweight
    [1.0, 0.72], // broad and spreading
  ] as const,
  ROCK_VARIANTS: [
    [0.85, 1.15], // chunky upright block
    [1.2, 0.78], // rough boulder
    [0.7, 0.55], // low flat slab
  ] as const,

  /** Per-instance stretch, applied independently to width and height, so
   *  two trees sharing a canopy shape still read as different trees.
   *  Uniform scaling alone makes a forest of clones at assorted sizes. */
  TREE_STRETCH_JITTER: 0.22,
  /** Maximum lean off vertical, radians. Small — leaning trees read as
   *  wind-shaped; too much and they look felled. */
  TREE_LEAN: 0.13,

  ROCK_RADIUS: 1.6,
  ROCK_RADIUS_JITTER: 0.5,
  /** Rocks are squashed spheres — 1 is a ball, lower is a boulder. */
  ROCK_FLATTEN: 0.62,
  ROCK_LUMPINESS: 0.35,
  ROCK_STRETCH_JITTER: 0.34,

  /** Ambient scatter. Props are placed on a jittered grid of this cell
   *  size, then thinned by a low-frequency noise field so trees gather
   *  into groves instead of dotting the map evenly — a grove on a ridge
   *  is a landmark, one tree every 40m is wallpaper. */
  SCATTER_CELL: 34.0,
  GROVE_FREQUENCY: 0.005,
  /** Noise above this becomes a grove; raise for fewer, tighter groves.
   *  Negative values mean most of the map qualifies and the field only
   *  carves out clearings — which is what a meadow wants. */
  GROVE_THRESHOLD: -0.2,
  /** Chance a qualifying cell actually gets a prop. */
  CELL_FILL_CHANCE: 0.72,
  /** Of the props placed, the fraction that are rocks rather than trees. */
  ROCK_FRACTION: 0.3,

  /** Ground-flatness limits, as dot(normal, up) — 1.0 is level ground,
   *  0.0 is a vertical cliff. Trees need genuinely gentle ground to look
   *  planted; rocks tolerate a much steeper lie. Raise either value to
   *  restrict that prop to flatter ground. */
  TREE_MIN_FLATNESS: 0.8,
  ROCK_MIN_FLATNESS: 0.5,

  /** Canopy scale when the land is fully dead, as a fraction of its live
   *  size. Dead trees are bare, sparse silhouettes; blooming the ground
   *  under them fills them back out (the PRD's `revive-props`, driven by
   *  the same vitality field as the grass). */
  CANOPY_DEAD_SCALE: 0.45,
} as const;

// ---------------------------------------------------------------------------
// EDITOR (the ?edit=1 placement tool — dev only, never ships)
// ---------------------------------------------------------------------------

export const EDITOR = {
  /** Maximum flowers in a named cluster (opened with C). A Shift+drag
   *  paint stroke stops placing when the open cluster reaches this, so a
   *  drag lays down "one line's worth" and no more — Patrick's request
   *  after the first authoring session. The PRD's Dream 1 lines are ~15
   *  flowers, so that's the default. Loose flowers dropped with no
   *  cluster open are exempt (that bucket is a scratchpad, and silently
   *  refusing drops there would just read as the tool breaking). */
  CLUSTER_FLOWER_LIMIT: 15,
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

  /** LinearToneMapping exposure multiplier (renderer.toneMappingExposure).
   *  Found during the Phase 1 fresh review: without tone mapping, scene
   *  lighting can only ever dim a surface's own base colour, never brighten
   *  it past that value — and sRGB→linear conversion (see paletteColor())
   *  disproportionately crushes already-dark palette colours further.
   *  That's why repeated rounds of lightening palette hexes and raising
   *  LIGHT_WRAP floors never fully fixed "still too dark": neither one adds
   *  actual exposure headroom. Also found: three.js only *defines* the
   *  toneMapping() GLSL function for custom ShaderMaterials, it never calls
   *  it — grass.frag.glsl/terrain.frag.glsl call it explicitly at
   *  gl_FragColor, or this constant would have no effect on them at all.
   *  1.0 is neutral; >1 genuinely brightens the whole scene, sun and all. */
  EXPOSURE: 2.0,
};
