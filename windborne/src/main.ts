import * as THREE from 'three';
import { Loop } from './core/Loop';
import { Input } from './core/Input';
import { WindController, type LevelBounds } from './player/WindController';
import { ChaseCamera } from './player/ChaseCamera';
import { Terrain, type TerrainConfig } from './world/Terrain';
import { GrassField } from './world/GrassField';
import { getPalette, paletteColor } from './config/palettes';
import { POST } from './config/tuning';

// ---------------------------------------------------------------------------
// Phase 1: heightfield terrain and instanced grass. No level JSON yet
// (that's Phase 3) — this bounds box and these noise octaves are a
// temporary stand-in for real level content, not an authored level.
// ---------------------------------------------------------------------------
const TEST_BOUNDS: LevelBounds = { min: [-250, -250], max: [250, 250] };

// Terrain and grass are generated over a larger area than TEST_BOUNDS itself.
// GrassField.rebuild() hard-excludes any chunk that doesn't fit entirely
// within its bounds (see its own comment) with no fade at all, unlike the
// LOD ring boundaries — confirmed by a synthetic flight test: ring 0's
// instance count dropped 78% by x=266, just 16m past the 250 edge, which
// WindController's boundary steering assist doesn't reliably prevent (it
// steers, it doesn't clamp). Real authored level bounds with proper edge
// treatment are Phase 3's job; padding generation well past where a player
// can realistically end up sidesteps the glitch for this temporary
// placeholder without pretending to solve level-edge design.
const GENERATION_PADDING = 150;
const GENERATION_BOUNDS: LevelBounds = {
  min: [TEST_BOUNDS.min[0] - GENERATION_PADDING, TEST_BOUNDS.min[1] - GENERATION_PADDING],
  max: [TEST_BOUNDS.max[0] + GENERATION_PADDING, TEST_BOUNDS.max[1] + GENERATION_PADDING],
};

const TEST_TERRAIN_CONFIG: TerrainConfig = {
  seed: 20260803,
  bounds: GENERATION_BOUNDS,
  octaves: [
    { frequency: 0.006, amplitude: 8.0 },
    { frequency: 0.02, amplitude: 3.0 },
    { frequency: 0.06, amplitude: 0.8 },
  ],
};

const palette = getPalette('meadow-morning');

const appRoot = document.getElementById('app');
if (!appRoot) throw new Error('#app root element missing');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
// Tone mapping + exposure: see POST.EXPOSURE's comment in tuning.ts — without
// this, lighting can only dim a surface's base colour, never brighten it
// past its own (sRGB-crushed) value. Linear (not ACES) because ACES's
// filmic shadow toe fights the exposure boost instead of helping it, and
// this is meant to be a bright, cheerful game rather than a cinematic one.
renderer.toneMapping = THREE.LinearToneMapping;
renderer.toneMappingExposure = POST.EXPOSURE;
appRoot.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = paletteColor(palette.fog.color);
scene.fog = new THREE.Fog(paletteColor(palette.fog.color), palette.fog.near, palette.fog.far);

// Sun direction from the palette so lighting is consistent between the
// terrain's vertex-colour shading and the grass shader's sun-relative
// backlight term — both read the same direction/colour/intensity.
const sunElevationRad = THREE.MathUtils.degToRad(palette.sky.sunElevation);
const sunAzimuthRad = THREE.MathUtils.degToRad(palette.sky.sunAzimuth);
const sunDirection = new THREE.Vector3(
  Math.cos(sunElevationRad) * Math.cos(sunAzimuthRad),
  Math.sin(sunElevationRad),
  Math.cos(sunElevationRad) * Math.sin(sunAzimuthRad),
).normalize();
const sunColor = paletteColor(palette.sky.sun);
const ambientColor = paletteColor(palette.sky.zenith);

const sunLight = new THREE.DirectionalLight(sunColor, palette.sky.sunIntensity);
sunLight.position.copy(sunDirection).multiplyScalar(200);
scene.add(sunLight);
scene.add(new THREE.AmbientLight(ambientColor, palette.sky.ambientIntensity));

const terrain = new Terrain(TEST_TERRAIN_CONFIG, palette);
scene.add(terrain.group);

const grassField = new GrassField(
  { seed: TEST_TERRAIN_CONFIG.seed, bounds: GENERATION_BOUNDS, getHeightAt: terrain.getHeightAt.bind(terrain) },
  palette,
);
grassField.setLighting(sunDirection, sunColor, palette.sky.sunIntensity, ambientColor, palette.sky.ambientIntensity);
scene.add(grassField.group);
terrain.setLighting(sunDirection, sunColor, palette.sky.sunIntensity, ambientColor, palette.sky.ambientIntensity);

const getGroundHeight = terrain.getHeightAt.bind(terrain);

// The player: a coloured cone standing in for the lead petal until
// PetalTrail exists in Phase 2.
const player = new THREE.Mesh(
  new THREE.ConeGeometry(0.5, 1.6, 12),
  new THREE.MeshStandardMaterial({ color: 0xf2a0c4 }),
);
scene.add(player);

const windController = new WindController();
const spawnGroundY = terrain.getHeightAt(0, 0);
windController.setPosition(0, spawnGroundY + 15, 0);
windController.setHeading(0, 0, -1);

const chaseCamera = new ChaseCamera(window.innerWidth / window.innerHeight);
chaseCamera.teleport(windController.position, windController.heading);

const input = new Input(renderer.domElement);

const scratchPosition = new THREE.Vector3();
const scratchHeading = new THREE.Vector3();
const scratchCameraForward = new THREE.Vector3();
const coneDefaultUp = new THREE.Vector3(0, 1, 0);
const coneQuaternion = new THREE.Quaternion();
const clockStart = performance.now();

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  chaseCamera.setAspect(window.innerWidth / window.innerHeight);
});

const loop = new Loop(
  (dt) => {
    const inputState = input.poll(dt, windController.heading);
    windController.update(dt, inputState, TEST_BOUNDS, getGroundHeight);
    chaseCamera.fixedUpdate(dt, windController.position, windController.heading, inputState.steerYaw, windController.speed);
    grassField.fixedUpdate(dt, windController.position);
  },
  (alpha) => {
    windController.getInterpolatedPosition(alpha, scratchPosition);
    windController.getInterpolatedHeading(alpha, scratchHeading);

    player.position.copy(scratchPosition);
    coneQuaternion.setFromUnitVectors(coneDefaultUp, scratchHeading);
    player.quaternion.copy(coneQuaternion);

    chaseCamera.render(alpha);
    chaseCamera.camera.getWorldDirection(scratchCameraForward);
    const elapsedTime = (performance.now() - clockStart) / 1000;
    grassField.render(elapsedTime, scratchCameraForward, scratchPosition);
    terrain.render(scratchPosition);

    renderer.render(scene, chaseCamera.camera);

    perfHUD?.setInstanceCounts({ grass: grassField.getVisibleInstanceCount() });
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
  }, renderer);
}

loop.start();
