// Terrain fragment shader: the baked slope-based colour, plus a
// noise-modulated "fake grass" tint that fades in starting exactly where
// GrassField's real grass fades out (see uFakeGrassStart/uFakeGrassFull,
// computed from the same GRASS.LOD_RINGS/EDGE_FADE_BAND in Terrain.ts) —
// per PRD §6.2, "the terrain shader fakes grass with noise-modulated
// colour." Gated by vGrassiness so cliffs and dirt patches don't suddenly
// look grassy just because they're far away.
precision highp float;

uniform vec3 uPlayerPosition;
uniform float uFakeGrassStart;
uniform float uFakeGrassFull;
uniform float uHorizonPatchScale;
uniform vec3 uFakeGrassBase;
uniform vec3 uFakeGrassBright;

uniform vec3 uSunDirection;
uniform vec3 uSunColor;
uniform float uSunIntensity;
uniform vec3 uAmbientColor;
uniform float uAmbientIntensity;
uniform float uLightWrap;
uniform float uPlayerGlowRadius;
uniform float uPlayerGlowIntensity;

varying vec3 vColor;
varying float vGrassiness;
varying vec3 vWorldPosition;
varying vec3 vNormal;

void main() {
  float distToPlayer = length(vWorldPosition.xz - uPlayerPosition.xz);
  float fakeFactor = smoothstep(uFakeGrassStart, uFakeGrassFull, distToPlayer) * vGrassiness;

  float patchNoise = snoise(vWorldPosition.xz * uHorizonPatchScale) * 0.5 + 0.5;
  vec3 fakeColor = mix(uFakeGrassBase, uFakeGrassBright, patchNoise);

  vec3 color = mix(vColor, fakeColor, fakeFactor);

  // Wide wrap term (PRD §6.1): a plain max(dot, 0) cuts off hard exactly at
  // the terminator, and with this terrain's deliberately dark base colour
  // that reads as the shadowed side going almost to black — including
  // slopes facing squarely away from the sun, not just grazing ones, so
  // this is a floor on diffuse rather than just a softened falloff at 90
  // degrees. uLightWrap is that floor; diffuse ramps from it up to 1 as
  // the surface turns to face the sun.
  vec3 normal = normalize(vNormal);
  float ndotl = dot(normal, uSunDirection);
  float diffuse = mix(uLightWrap, 1.0, max(ndotl, 0.0));
  vec3 lit = color * (uAmbientColor * uAmbientIntensity + uSunColor * uSunIntensity * diffuse);

  // Player glow: a soft light that travels with the player, so the ground
  // immediately around it reads as clearly lit regardless of sun angle or
  // shadow — not from the PRD, added because the wrap/floor fixes above
  // have a ceiling (the base colour's own brightness) and the area you're
  // actually looking at most of the time benefits from its own light
  // rather than depending entirely on the sun. XZ distance only, like a
  // light shining straight down, so the ground below reads as lit at any
  // altitude rather than fading out as the player climbs.
  float glow = uPlayerGlowIntensity * (1.0 - smoothstep(0.0, uPlayerGlowRadius, distToPlayer));
  lit += color * uSunColor * glow;

  gl_FragColor = vec4(lit, 1.0);
}
