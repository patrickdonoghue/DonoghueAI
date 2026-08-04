// Grass blade fragment shader: base→tip colour ramp, root darkening (fake
// AO), low-frequency patchiness, and a backlight/translucency term that
// does most of the work of making the field look alive rather than
// plastic. Unlit-but-shaded — no scene lights are sampled; sun and ambient
// are passed in directly since a fully custom lighting model is cheaper
// and easier to keep consistent with the terrain's than wiring into
// three's light uniforms.
precision highp float;

uniform vec3 uAliveBase;
uniform vec3 uAliveTip;
uniform vec3 uDeadBase;
uniform vec3 uDeadTip;
uniform float uVitality; // 0 dead, 1 alive — always 1.0 until Phase 2's VitalityField

uniform float uRootDarken;
uniform float uPatchScale;
uniform float uPatchStrength;
uniform float uBacklightStrength;
uniform float uBacklightPower;

uniform vec3 uSunDirection; // surface-to-light, normalized
uniform vec3 uSunColor;
uniform float uSunIntensity;
uniform vec3 uAmbientColor;
uniform float uAmbientIntensity;
uniform float uLightWrap;
uniform vec3 uCameraForward;
uniform vec3 uPlayerPosition;
uniform float uPlayerGlowRadius;
uniform float uPlayerGlowIntensity;

varying vec3 vWorldPosition;
varying vec3 vNormal;
varying float vHeightFraction;

void main() {
  vec3 baseColor = mix(uDeadBase, uAliveBase, uVitality);
  vec3 tipColor = mix(uDeadTip, uAliveTip, uVitality);
  vec3 color = mix(baseColor, tipColor, vHeightFraction);

  // Fake ambient occlusion: darken toward the root.
  color *= mix(1.0 - uRootDarken, 1.0, smoothstep(0.0, 0.35, vHeightFraction));

  // Low-frequency patchiness so the field doesn't read as a uniform carpet.
  float patchNoise = snoise(vWorldPosition.xz * uPatchScale) * 0.5 + 0.5;
  color = mix(color, color * patchNoise, uPatchStrength);

  // Wrap/floor term, same reasoning as Terrain's: a blade's normal is
  // just its local (0,0,1) rotated by that instance's random yaw, so
  // roughly half of any dense patch faces away from the sun at any
  // moment. A plain max(dot, 0) sent that half to ambient-only and the
  // whole field read as patchy-dark rather than evenly lit.
  vec3 normal = normalize(vNormal);
  float ndotl = dot(normal, uSunDirection);
  float diffuse = mix(uLightWrap, 1.0, max(ndotl, 0.0));
  vec3 lit = color * (uAmbientColor * uAmbientIntensity + uSunColor * uSunIntensity * diffuse);

  // Backlight/translucency: strongest when the sun is roughly behind the
  // blade from the camera's point of view.
  float backlit = pow(clamp(-dot(uCameraForward, uSunDirection), 0.0, 1.0), uBacklightPower);
  lit += uSunColor * uSunIntensity * backlit * uBacklightStrength * color;

  // Player glow: see Terrain's fragment shader for the full reasoning —
  // same soft, travels-with-the-player light, same formula (XZ distance
  // only, like a light shining straight down so it doesn't fade out as
  // the player gains altitude), so the two systems light the immediate
  // area consistently.
  float distToPlayerXZ = length(vWorldPosition.xz - uPlayerPosition.xz);
  float glow = uPlayerGlowIntensity * (1.0 - smoothstep(0.0, uPlayerGlowRadius, distToPlayerXZ));
  lit += color * uSunColor * glow;

  gl_FragColor = vec4(lit, 1.0);
}
