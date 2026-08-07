// Flower vertex shader.
//
// A flower is one instanced geometry whose vertices carry a parametric
// description (aPart) alongside their raw position, so the bloom
// animation — petals unfurling, stem straightening — is pure per-vertex
// math driven by a per-instance bloom timestamp. Blooming a flower is a
// one-float attribute write, not a mesh swap (PRD §5.3).
//
// aPart layout:
//   x: radial fraction along the petal, 0 at the hinge, 1 at the tip
//   y: signed width offset across the petal, in metres
//   z: the petal's azimuth around the stem, radians
//   w: part id — 0 stem, 1 petal, 2 centre disc
//
// Stem and centre-disc vertices use their raw `position` (scaled by the
// stem-straightening factor); petal vertices are reconstructed entirely
// from aPart so the fold angle can rotate them around their hinge at the
// stem top without any per-petal bones or matrices.

uniform float uTime;
uniform float uAnimDuration;
uniform float uStemHeight;
uniform float uPetalLength;
uniform float uFoldClosed;
uniform float uFoldOpen;
uniform float uStemScaleClosed;

attribute vec4 aPart;
attribute float aBloomTime;
attribute vec3 aPetalColor;
attribute vec3 aCenterColor;

varying vec3 vColor;
varying vec3 vNormal;
varying vec3 vWorldPosition;
varying float vBloomState;
varying float vBloomAge;

void main() {
  // 0 while unbloomed (aBloomTime < 0 is the sentinel), else 0→1 over
  // the animation. Smoothstepped so the unfurl eases in and out.
  float raw = aBloomTime < 0.0 ? 0.0 : clamp((uTime - aBloomTime) / uAnimDuration, 0.0, 1.0);
  float state = raw * raw * (3.0 - 2.0 * raw);
  vBloomState = state;
  vBloomAge = aBloomTime < 0.0 ? 1e6 : (uTime - aBloomTime);

  float stemScale = mix(uStemScaleClosed, 1.0, state);
  vec3 localPos;
  vec3 localNormal;

  if (aPart.w > 1.5) {
    // Centre disc: rides the stem top, faces up.
    localPos = vec3(position.x, position.y * stemScale, position.z);
    localNormal = vec3(0.0, 1.0, 0.0);
    vColor = aCenterColor;
  } else if (aPart.w > 0.5) {
    // Petal: rotate around the hinge at the stem top. The fold angle is
    // measured up from horizontal — closed buds point nearly straight up,
    // open petals settle just above horizontal. The tip folds slightly
    // more than the base (radial² term) so open petals cup instead of
    // lying flat like a propeller.
    float fold = mix(uFoldClosed, uFoldOpen, state) + aPart.x * aPart.x * 0.35 * state;
    vec2 dir = vec2(cos(aPart.z), sin(aPart.z));
    float r = aPart.x * uPetalLength;
    vec3 outward = vec3(dir.x * cos(fold), sin(fold), dir.y * cos(fold));
    vec3 side = vec3(-dir.y, 0.0, dir.x);
    localPos = vec3(0.0, uStemHeight * stemScale, 0.0) + outward * r + side * aPart.y;
    // Petal surface normal: perpendicular to the fold direction, tilted
    // with it. Approximate rather than exact under the cupping term —
    // flowers are far too small on screen for that error to read.
    localNormal = normalize(vec3(dir.x * -sin(fold), cos(fold), dir.y * -sin(fold)));
    vColor = aPetalColor;
  } else {
    // Stem: straight quad cross, squashes vertically while unbloomed.
    localPos = vec3(position.x, position.y * stemScale, position.z);
    localNormal = vec3(0.0, 0.0, 1.0);
    vColor = aPetalColor * 0.35 + vec3(0.05, 0.12, 0.03); // stem greens toward the petal hue
  }

  vec4 worldPos = modelMatrix * instanceMatrix * vec4(localPos, 1.0);
  vWorldPosition = worldPos.xyz;
  vNormal = normalize((modelMatrix * instanceMatrix * vec4(localNormal, 0.0)).xyz);
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
