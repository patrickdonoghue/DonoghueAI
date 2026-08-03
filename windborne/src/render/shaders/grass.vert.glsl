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

varying vec3 vWorldPosition;
varying vec3 vNormal;
varying float vHeightFraction;

void main() {
  float t = position.y;
  vHeightFraction = t;

  // Static natural curve: baked per-blade, scaled by this instance's own
  // height via instanceMatrix.scale.z so taller blades curve proportionally
  // more. Direction follows the blade's own random yaw.
  vec3 localPos = position;
  localPos.z += uCurveAmount * t * t;

  vec3 worldPos = (modelMatrix * instanceMatrix * vec4(localPos, 1.0)).xyz;
  vec3 rootWorldPos = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec2 rootXZ = rootWorldPos.xz;

  // Wind: two scrolling noise layers plus a slow, large-scale gust wave,
  // all sampled at the blade's world-space root so a whole patch sways
  // together. Do not thin this out to save frames — the gust wave is what
  // makes wind read as weather rather than "the grass is animated."
  float n1 = snoise(rootXZ * uWindLayer1.x + uWindDirection * uTime * uWindLayer1.z);
  float n2 = snoise(rootXZ * uWindLayer2.x + uWindDirection * uTime * uWindLayer2.z);
  float gust = snoise(rootXZ * uWindGust.x + uWindDirection * uTime * uWindGust.z);
  float windMagnitude = uWindBaseStrength + n1 * uWindLayer1.y + n2 * uWindLayer2.y + gust * uWindGust.y;
  float windFalloff = pow(t, 1.5); // pinned at the root, most bend at the tip
  vec2 windOffsetXZ = uWindDirection * windMagnitude * windFalloff;

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
  vec2 deflectOffsetXZ = deflectDirXZ * deflectAmount * uDeflectStrength * windFalloff;

  worldPos.xz += windOffsetXZ + deflectOffsetXZ;

  // Edge-on widening: a blade whose width axis points close to straight at
  // the camera covers almost no pixels and sparkles at distance. Widen it
  // proportionally to how edge-on it is. Approximated from the blade's
  // width axis vs. the camera's view direction rather than a full
  // view-space projection — cheap, and the effect only needs to be
  // roughly right.
  vec3 worldRight = normalize((modelMatrix * instanceMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
  float edgeOn = abs(dot(worldRight, uCameraForward));
  float widen = 1.0 + edgeOn * uViewWiden;
  worldPos += worldRight * (widen - 1.0) * position.x;

  vWorldPosition = worldPos;
  vNormal = normalize((modelMatrix * instanceMatrix * vec4(normal, 0.0)).xyz);

  gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
}
