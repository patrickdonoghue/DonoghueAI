// Petal fragment shader: the shared wrap lighting model (see the note in
// petal.vert.glsl for why petals can't use a stock material), fog, and
// the explicit toneMapping() call every custom material here needs.
precision highp float;

uniform vec3 uSunDirection;
uniform vec3 uSunColor;
uniform float uSunIntensity;
uniform vec3 uAmbientColor;
uniform float uAmbientIntensity;
uniform float uLightWrap;

uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;

varying vec3 vColor;
varying vec3 vNormal;
varying vec3 vWorldPosition;

void main() {
  vec3 normal = normalize(vNormal);
  // abs(): petals are thin double-sided quads, lit symmetrically.
  float ndotl = abs(dot(normal, uSunDirection));
  float diffuse = mix(uLightWrap, 1.0, ndotl);
  // Ambient is desaturated toward white before it multiplies the petal:
  // full-strength blue sky ambient is exactly what turned pink petals
  // navy under the standard pipeline.
  vec3 softAmbient = mix(vec3(dot(uAmbientColor, vec3(0.333))), uAmbientColor, 0.35);
  vec3 lit = vColor * (softAmbient * uAmbientIntensity + uSunColor * uSunIntensity * diffuse);

  float fogDist = length(vWorldPosition - cameraPosition);
  float fogFactor = smoothstep(uFogNear, uFogFar, fogDist);
  lit = mix(lit, uFogColor, fogFactor);

  gl_FragColor = vec4(toneMapping(lit), 1.0);
}
