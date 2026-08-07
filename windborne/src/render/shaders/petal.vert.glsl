// Petal vertex shader: a plain instanced transform. The only reason this
// isn't a stock material is lighting — the scene's ambient is a strongly
// blue sky colour, and three's standard pipeline rendered petals facing
// away from the sun as navy (ambient-only × pink = blue). The custom
// fragment shader lights petals with the same wrap model as grass,
// terrain, and flowers, so a pink petal stays recognisably pink from
// every angle.

// NOTE: no `attribute vec3 instanceColor;` here — three injects that
// declaration itself whenever the InstancedMesh has instanceColor set
// (redeclaring it is a compile error), so it's simply used below.

varying vec3 vColor;
varying vec3 vNormal;
varying vec3 vWorldPosition;

void main() {
  vColor = instanceColor;
  vec4 worldPos = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vWorldPosition = worldPos.xyz;
  vNormal = normalize((modelMatrix * instanceMatrix * vec4(normal, 0.0)).xyz);
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
