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

  vec3 normal = normalize(vNormal);
  float diffuse = max(dot(normal, uSunDirection), 0.0);
  vec3 lit = color * (uAmbientColor * uAmbientIntensity + uSunColor * uSunIntensity * diffuse);

  gl_FragColor = vec4(lit, 1.0);
}
