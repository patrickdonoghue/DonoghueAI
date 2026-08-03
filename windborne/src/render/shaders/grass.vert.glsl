// Grass blade vertex shader.
//
// Geometry convention (see GrassField.ts for how the blade mesh is built):
// local position.y is a HEIGHT FRACTION 0 (root) to 1 (tip), not metres —
// the actual height lives in instanceMatrix's scale, so a single shared
// geometry works for every instance's jittered height. local position.x is
// the half-width offset in real metres (baked at build time, not scaled).
//
// Everything that needs to look world-consistent regardless of a blade's
// own random yaw — wind, gusts, the deflection wake — is computed AFTER
// the instance transform, directly in world space. Only the static per-
// blade curve is applied in local space, so it curves toward each blade's
// own (randomly yawed) forward direction — a deliberate source of variety,
// not an oversight.
#define TRAIL_MAX 24

uniform float uTime;

uniform vec2 uWindDirection; // normalized, XZ
uniform float uWindBaseStrength;
uniform vec3 uWindLayer1; // frequency, amplitude, scroll speed
uniform vec3 uWindLayer2;
uniform vec3 uWindGust;

uniform vec3 uTrailPositions[TRAIL_MAX];
uniform float uTrailWeights[TRAIL_MAX]; // recency-decayed 0..1, precomputed on the CPU
uniform int uTrailCount;
uniform float uDeflectRadius;
uniform float uDeflectStrength;

uniform float uCurveAmount;
uniform float uViewWiden;
uniform vec3 uCameraForward;

uniform vec3 uPlayerPosition;
uniform float uMaxRadius; // this ring's outer radius — see the fade note below
uniform float uFadeBand;

varying vec3 vWorldPosition;
varying vec3 vNormal;
varying float vHeightFraction;

void main() {
  float t = position.y;
  vHeightFraction = t;

  // Actual per-instance blade height, recovered from instanceMatrix's own
  // scale (baked in GrassField.ts as scale.y = scale.z = height) rather
  // than passed as a separate attribute. Rotation preserves vector length,
  // so this is exact regardless of the blade's random yaw.
  float actualHeight = length(instanceMatrix[1].xyz);

  // Static natural curve: baked per-blade, scaled by this instance's own
  // height via instanceMatrix.scale.z so taller blades curve proportionally
  // more. Direction follows the blade's own random yaw.
  vec3 localPos = position;
  localPos.z += uCurveAmount * t * t;

  vec3 rootWorldPos = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec2 rootXZ = rootWorldPos.xz;

  // LOD edge fade: shrink a blade toward its root as it nears this ring's
  // outer radius, so a grass chunk crossing between rings (or leaving
  // range entirely) fades to nothing before GrassField's rebuild actually
  // drops or re-tiers it, instead of popping at full size.
  float distToPlayer = length(rootXZ - uPlayerPosition.xz);
  float edgeFade = 1.0 - smoothstep(uMaxRadius - uFadeBand, uMaxRadius, distToPlayer);
  localPos *= edgeFade;

  vec3 worldPos = (modelMatrix * instanceMatrix * vec4(localPos, 1.0)).xyz;

  // Wind: two scrolling noise layers plus a slow, large-scale gust wave,
  // all sampled at the blade's world-space root so a whole patch sways
  // together. Do not thin this out to save frames — the gust wave is what
  // makes wind read as weather rather than "the grass is animated."
  // Magnitudes in tuning.ts are fractions of blade height, not metres —
  // scaling by actualHeight is what keeps a gust to a plausible sway
  // instead of whipping the tip several blade-heights sideways.
  float n1 = snoise(rootXZ * uWindLayer1.x + uWindDirection * uTime * uWindLayer1.z);
  float n2 = snoise(rootXZ * uWindLayer2.x + uWindDirection * uTime * uWindLayer2.z);
  float gust = snoise(rootXZ * uWindGust.x + uWindDirection * uTime * uWindGust.z);
  float windMagnitude = uWindBaseStrength + n1 * uWindLayer1.y + n2 * uWindLayer2.y + gust * uWindGust.y;
  float windFalloff = pow(t, 1.5); // pinned at the root, most bend at the tip
  vec2 windOffsetXZ = uWindDirection * windMagnitude * windFalloff * actualHeight;

  // Player deflection wake: each recent trail sample pushes nearby blades
  // away radially. Weight is precomputed on the CPU from how long ago the
  // sample was recorded (see GrassField.ts) — that's what gives the wake
  // its recovery lag instead of snapping upright the instant the player
  // passes. Max, not sum, so lingering stale-but-close samples don't pile
  // up into an ever-growing bend.
  float deflectAmount = 0.0;
  vec2 deflectDirXZ = vec2(0.0);
  for (int i = 0; i < TRAIL_MAX; i++) {
    if (i >= uTrailCount) break;
    vec2 toBlade = rootXZ - uTrailPositions[i].xz;
    float dist = length(toBlade);
    float falloff = 1.0 - smoothstep(0.0, uDeflectRadius, dist);
    float amount = falloff * uTrailWeights[i];
    if (amount > deflectAmount) {
      deflectAmount = amount;
      deflectDirXZ = dist > 1e-4 ? toBlade / dist : vec2(0.0);
    }
  }
  vec2 deflectOffsetXZ = deflectDirXZ * deflectAmount * uDeflectStrength * windFalloff * actualHeight;

  worldPos.xz += windOffsetXZ + deflectOffsetXZ;

  // Widening: two different reasons a blade can cover too few pixels.
  // (1) Edge-on: its width axis points close to straight at the camera —
  //     happens at any pitch, depends on the blade's yaw.
  // (2) Top-down: the camera is looking steeply down, so the blade's
  //     HEIGHT foreshortens toward nothing and only its (always-thin)
  //     width axis remains — happens to every blade regardless of yaw,
  //     which (1) alone doesn't catch since a steep-down camera forward
  //     vector is mostly vertical and near-orthogonal to any horizontal
  //     width axis, reading as barely edge-on when it's the case that
  //     most needs compensating.
  // Take whichever of the two calls for more widening.
  vec3 worldRight = normalize((modelMatrix * instanceMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
  float edgeOn = abs(dot(worldRight, uCameraForward));
  float topDown = clamp(-uCameraForward.y, 0.0, 1.0);
  float widen = 1.0 + max(edgeOn, topDown) * uViewWiden;
  worldPos += worldRight * (widen - 1.0) * localPos.x;

  vWorldPosition = worldPos;
  vNormal = normalize((modelMatrix * instanceMatrix * vec4(normal, 0.0)).xyz);

  gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
}
