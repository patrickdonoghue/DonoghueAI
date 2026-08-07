// Flower fragment shader: the same hand-rolled wrap lighting as grass and
// terrain (so all three systems sit in one lighting world), a dimming
// factor for unbloomed buds, the brief emissive pulse on bloom, fog, and
// the explicit toneMapping() call every custom material here needs.
precision highp float;

uniform vec3 uSunDirection;
uniform vec3 uSunColor;
uniform float uSunIntensity;
uniform vec3 uAmbientColor;
uniform float uAmbientIntensity;
uniform float uLightWrap;

uniform float uBudDimming;
uniform float uFlashIntensity;
uniform float uFlashDuration;

uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;

varying vec3 vColor;
varying vec3 vNormal;
varying vec3 vWorldPosition;
varying float vBloomState;
varying float vBloomAge;

void main() {
  // Buds render dim and desaturated; colour arrives with the bloom.
  float grey = dot(vColor, vec3(0.299, 0.587, 0.114));
  vec3 budColor = mix(vec3(grey), vColor, 0.4) * uBudDimming;
  vec3 color = mix(budColor, vColor, vBloomState);

  vec3 normal = normalize(vNormal);
  // abs() rather than a floor: petals are thin double-sided surfaces, so
  // light them symmetrically instead of wrap-flooring a backface.
  float ndotl = abs(dot(normal, uSunDirection));
  float diffuse = mix(uLightWrap, 1.0, ndotl);
  vec3 lit = color * (uAmbientColor * uAmbientIntensity + uSunColor * uSunIntensity * diffuse);

  // Bloom flash: a short additive pulse of the flower's own colour.
  // vBloomAge is huge for unbloomed flowers, so this term is zero there.
  float flash = uFlashIntensity * max(0.0, 1.0 - vBloomAge / uFlashDuration);
  lit += vColor * flash;

  float fogDist = length(vWorldPosition - cameraPosition);
  float fogFactor = smoothstep(uFogNear, uFogFar, fogDist);
  lit = mix(lit, uFogColor, fogFactor);

  gl_FragColor = vec4(toneMapping(lit), 1.0);
}
