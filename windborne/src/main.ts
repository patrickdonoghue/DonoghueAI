import * as THREE from 'three';
import { Loop } from './core/Loop';
import { Input } from './core/Input';
import { WindController, type LevelBounds } from './player/WindController';
import { ChaseCamera } from './player/ChaseCamera';

// ---------------------------------------------------------------------------
// Phase 0: flat grey plane, a cone for the player, chase camera, input.
// No terrain, no level JSON yet — those are Phase 1 and Phase 3. This bounds
// box is a temporary stand-in for a real level's bounds so the flight
// model's boundary behaviour can be tested; it is not level content.
// ---------------------------------------------------------------------------
const TEST_BOUNDS: LevelBounds = { min: [-250, -250], max: [250, 250] };
const getGroundHeight = (): number => 0; // flat plane at y = 0

const appRoot = document.getElementById('app');
if (!appRoot) throw new Error('#app root element missing');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
appRoot.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xbfc7cc);

scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.2);
sun.position.set(80, 120, 40);
scene.add(sun);

// Grey ground with a faint grid so speed and altitude are legible even
// with no terrain or grass yet — a testing aid, not decoration. Trivial to
// remove; not part of any dream's art.
const ground = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), new THREE.MeshStandardMaterial({
  color: 0x9a9a92,
  map: makeGridTexture(),
}));
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

function makeGridTexture(): THREE.Texture {
  const size = 256;
  const cellsPerSide = 8;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#9a9a92';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = '#87877e';
  ctx.lineWidth = 2;
  const cell = size / cellsPerSide;
  for (let i = 0; i <= cellsPerSide; i++) {
    ctx.beginPath();
    ctx.moveTo(i * cell, 0);
    ctx.lineTo(i * cell, size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i * cell);
    ctx.lineTo(size, i * cell);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(60, 60);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// The player: a coloured cone standing in for the lead petal until
// PetalTrail exists in Phase 2.
const player = new THREE.Mesh(
  new THREE.ConeGeometry(0.5, 1.6, 12),
  new THREE.MeshStandardMaterial({ color: 0xf2a0c4 }),
);
scene.add(player);

const windController = new WindController();
windController.setPosition(0, 10, 0);
windController.setHeading(0, 0, -1);

const chaseCamera = new ChaseCamera(window.innerWidth / window.innerHeight);
chaseCamera.teleport(windController.position, windController.heading);

const input = new Input(renderer.domElement);

const scratchPosition = new THREE.Vector3();
const scratchHeading = new THREE.Vector3();
const coneDefaultUp = new THREE.Vector3(0, 1, 0);
const coneQuaternion = new THREE.Quaternion();

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  chaseCamera.setAspect(window.innerWidth / window.innerHeight);
});

const loop = new Loop(
  (dt) => {
    const inputState = input.poll(dt, chaseCamera.camera);
    windController.update(dt, inputState, TEST_BOUNDS, getGroundHeight);
    chaseCamera.fixedUpdate(dt, windController.position, windController.heading, inputState.steerYaw, windController.speed);
  },
  (alpha) => {
    windController.getInterpolatedPosition(alpha, scratchPosition);
    windController.getInterpolatedHeading(alpha, scratchHeading);

    player.position.copy(scratchPosition);
    coneQuaternion.setFromUnitVectors(coneDefaultUp, scratchHeading);
    player.quaternion.copy(coneQuaternion);

    chaseCamera.render(alpha);
    renderer.render(scene, chaseCamera.camera);

    perfHUD?.update(renderer);
  },
);

let perfHUD: import('./debug/PerfHUD').PerfHUD | undefined;

if (import.meta.env.DEV) {
  const [{ PerfHUD }, { TuningPanel }] = await Promise.all([
    import('./debug/PerfHUD'),
    import('./debug/TuningPanel'),
  ]);
  perfHUD = new PerfHUD();
  new TuningPanel((enabled) => {
    void input.setTiltEnabled(enabled);
  });
}

loop.start();
