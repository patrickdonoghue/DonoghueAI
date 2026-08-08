// Prop fragment shader: the same hand-rolled wrap lighting as grass,
// terrain, flowers and petals, so props sit in one lighting world with
// everything else. Colour lerps dead → alive by vitality (bare grey
// canopy to green, bare rock to faintly mossy), then fog, then the
// explicit toneMapping() call every custom material in this project
// needs (three defines it but never calls it for a ShaderMaterial).
precision highp float;

uniform vec3 uColorDead;
uniform vec3 uColorAlive;

uniform vec3 uSunDirection;
uniform vec3 uSunColor;
uniform float uSunIntensity;
uniform vec3 uAmbientColor;
uniform float uAmbientIntensity;
uniform float uLightWrap;

uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;

varying vec3 vNormal;
varying vec3 vWorldPosition;
varying float vVitality;

void main() {
  vec3 color = mix(uColorDead, uColorAlive, vVitality);

  vec3 normal = normalize(vNormal);
  float ndotl = dot(normal, uSunDirection);
  float diffuse = mix(uLightWrap, 1.0, max(ndotl, 0.0));
  vec3 lit = color * (uAmbientColor * uAmbientIntensity + uSunColor * uSunIntensity * diffuse);

  float fogDist = length(vWorldPosition - cameraPosition);
  float fogFactor = smoothstep(uFogNear, uFogFar, fogDist);
  lit = mix(lit, uFogColor, fogFactor);

  gl_FragColor = vec4(toneMapping(lit), 1.0);
}
