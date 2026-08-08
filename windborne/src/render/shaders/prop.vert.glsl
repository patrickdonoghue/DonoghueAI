// Prop vertex shader — trees (trunk + canopy) and rocks.
//
// One shader for all three parts; uPartKind selects behaviour:
//   0 trunk, 1 canopy, 2 rock
//
// The canopy shrinks toward uCanopyDeadScale on dead land and fills back
// out as the ground revives, which is the PRD's `revive-props` behaviour
// falling out of the vitality field for free rather than needing its own
// event plumbing.
//
// Vitality arrives as a per-instance attribute refreshed on the CPU (see
// Props.refreshVitality), NOT as a texture sample: vertex-stage fetches
// of the vitality texture silently return 0 on this project's
// development driver — the same trap that cost a debugging session on
// the grass. Colour-only consumers can sample in the fragment stage
// safely; anything that moves geometry uses the attribute.

uniform int uPartKind;
uniform float uCanopyDeadScale;

attribute float aVitality;

varying vec3 vNormal;
varying vec3 vWorldPosition;
varying float vVitality;

void main() {
  vVitality = aVitality;

  vec3 localPos = position;
  if (uPartKind == 1) {
    // Canopy: scale about its own base so it thins toward the branches
    // rather than floating away from the trunk. Local Y is already
    // measured from the canopy's underside (see buildCanopyGeometry).
    float scale = mix(uCanopyDeadScale, 1.0, aVitality);
    localPos.xz *= scale;
    localPos.y *= mix(0.7, 1.0, aVitality); // dead canopies squat as well as narrow
  }

  vec4 worldPos = modelMatrix * instanceMatrix * vec4(localPos, 1.0);
  vWorldPosition = worldPos.xyz;
  vNormal = normalize((modelMatrix * instanceMatrix * vec4(normal, 0.0)).xyz);
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
