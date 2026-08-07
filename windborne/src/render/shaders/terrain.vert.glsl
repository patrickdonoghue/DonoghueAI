// Terrain vertex shader. Positions are already in world space (baked
// directly into the geometry at build time in Terrain.ts, one chunk mesh
// per grid cell) — modelMatrix is carried through for correctness but is
// always identity here, since chunks never move.
attribute vec3 color; // baked slope-based grass/dirt/rock blend
attribute float grassiness; // 1 = flat/grass-eligible, 0 = steep rock/dirt

varying vec3 vColor;
varying float vGrassiness;
varying vec3 vWorldPosition;
varying vec3 vNormal;

void main() {
  vColor = color;
  vGrassiness = grassiness;
  vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
  vNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorldPosition, 1.0);
}
