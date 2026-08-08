import * as THREE from 'three';
import { Loop } from './core/Loop';
import { Input } from './core/Input';
import { WindController, type LevelBounds } from './player/WindController';
import { PetalTrail } from './player/PetalTrail';
import { ChaseCamera } from './player/ChaseCamera';
import { Terrain, type TerrainConfig } from './world/Terrain';
import { GrassField } from './world/GrassField';
import { VitalityField } from './world/VitalityField';
import { FlowerField, type FlowerPlacement } from './world/FlowerField';
import { getPalette, paletteColor } from './config/palettes';
import { POST } from './config/tuning';
import { parseLevel, flattenFlowers } from './level/LevelLoader';
import dream01Raw from './levels/dream-01.json';

// ---------------------------------------------------------------------------
// The level (PRD §7.2): authored JSON, edited with the ?edit=1 placement
// tool, hot-reloaded in dev. Only Dream 1 exists for v0.1.
// ---------------------------------------------------------------------------
const level = parseLevel(dream01Raw);
const LEVEL_BOUNDS: LevelBounds = level.bounds;

// Terrain and grass are generated over a larger area than the playable
// bounds. GrassField.rebuild() hard-excludes any chunk that doesn't fit
// entirely within its bounds (see its own comment) with no fade at all,
// unlike the LOD ring boundaries — confirmed by a synthetic flight test:
// ring 0's instance count dropped 78% just 16m past the boundary, which
// WindController's steering assist doesn't reliably prevent (it steers,
// it doesn't clamp). Proper level-edge treatment is future level-design
// work; padding generation well past where a player can realistically
// end up sidesteps the glitch without pretending to solve it.
const GENERATION_PADDING = 150;
const GENERATION_BOUNDS: LevelBounds = {
  min: [LEVEL_BOUNDS.min[0] - GENERATION_PADDING, LEVEL_BOUNDS.min[1] - GENERATION_PADDING],
  max: [LEVEL_BOUNDS.max[0] + GENERATION_PADDING, LEVEL_BOUNDS.max[1] + GENERATION_PADDING],
};

const TERRAIN_CONFIG: TerrainConfig = {
  seed: level.seed,
  bounds: GENERATION_BOUNDS,
  octaves: level.terrain.octaves,
};

const palette = getPalette(level.palette);

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

const terrain = new Terrain(TERRAIN_CONFIG, palette);
scene.add(terrain.group);

const grassField = new GrassField(
  { seed: TERRAIN_CONFIG.seed, bounds: GENERATION_BOUNDS, getHeightAt: terrain.getHeightAt.bind(terrain) },
  palette,
);
grassField.setLighting(sunDirection, sunColor, palette.sky.sunIntensity, ambientColor, palette.sky.ambientIntensity);
scene.add(grassField.group);
terrain.setLighting(sunDirection, sunColor, palette.sky.sunIntensity, ambientColor, palette.sky.ambientIntensity);

const getGroundHeight = terrain.getHeightAt.bind(terrain);

// The vitality field: the level starts dead, blooms splat life back in,
// and grass + terrain both read the same texture (PRD §5.4).
const vitalityField = new VitalityField(GENERATION_BOUNDS);
grassField.setVitality(vitalityField.texture, vitalityField.boundsMin, vitalityField.boundsSize);
grassField.sampleVitality = (x, z) => vitalityField.sampleAt(x, z);
terrain.setVitality(vitalityField.texture, vitalityField.boundsMin, vitalityField.boundsSize);

// The player is the lead petal of the trail (PRD §5.2) — this replaces
// the placeholder cone from Phases 0–1.
const petalTrail = new PetalTrail(palette, TERRAIN_CONFIG.seed);
petalTrail.setLighting(sunDirection, sunColor, palette.sky.sunIntensity, ambientColor, palette.sky.ambientIntensity);
scene.add(petalTrail.mesh);

// Flowers come from the level's authored clusters (the Phase 2 test line
// is gone — placement now belongs to Patrick and the ?edit=1 tool, which
// rebuilds this field live as flowers are placed).
function buildFlowerField(placements: FlowerPlacement[]): FlowerField {
  const field = new FlowerField(placements, palette, getGroundHeight, GENERATION_BOUNDS);
  field.setLighting(sunDirection, sunColor, palette.sky.sunIntensity, ambientColor, palette.sky.ambientIntensity);
  scene.add(field.mesh);
  return field;
}
let flowerField = buildFlowerField(flattenFlowers(level));

const windController = new WindController();
// Spawn from the level: heading is degrees, 0 = +Z (see LevelLoader).
const spawnHeadingRad = THREE.MathUtils.degToRad(level.spawn.heading);
windController.setPosition(level.spawn.position[0], level.spawn.position[1], level.spawn.position[2]);
windController.setHeading(Math.sin(spawnHeadingRad), 0, Math.cos(spawnHeadingRad));

// Bloom consequences (PRD §5.3): a petal joins the trail, the trail's
// pull on flight speed grows, and life splats into the vitality field.
// The chime joins this list in Phase 4.
const handleBloom: NonNullable<FlowerField['onBloom']> = (worldPosition, petalColor) => {
  petalTrail.spawnPetal(worldPosition, petalColor);
  windController.petalCount = petalTrail.count;
  vitalityField.splat(worldPosition.x, worldPosition.z);
  // Refresh per-blade vitality heights right away (colour needs nothing —
  // the grass fragment shader samples the field texture directly).
  grassField.requestRebuild();
};
flowerField.onBloom = handleBloom;

const chaseCamera = new ChaseCamera(window.innerWidth / window.innerHeight);
chaseCamera.teleport(windController.position, windController.heading);

const input = new Input(renderer.domElement);

const scratchPosition = new THREE.Vector3();
const scratchHeading = new THREE.Vector3();
const scratchCameraForward = new THREE.Vector3();
const clockStart = performance.now();

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  chaseCamera.setAspect(window.innerWidth / window.innerHeight);
});

const loop = new Loop(
  (dt) => {
    const inputState = input.poll(dt, windController.heading);
    windController.update(dt, inputState, LEVEL_BOUNDS, getGroundHeight);
    chaseCamera.fixedUpdate(dt, windController.position, windController.heading, inputState.steerYaw, windController.speed);
    grassField.fixedUpdate(dt, windController.position);
    petalTrail.fixedUpdate(windController.position);
    flowerField.fixedUpdate(windController.position);
  },
  (alpha) => {
    windController.getInterpolatedPosition(alpha, scratchPosition);
    windController.getInterpolatedHeading(alpha, scratchHeading);

    chaseCamera.render(alpha);
    chaseCamera.camera.getWorldDirection(scratchCameraForward);
    const elapsedTime = (performance.now() - clockStart) / 1000;
    petalTrail.render(elapsedTime, scratchPosition, alpha);
    flowerField.render(elapsedTime);
    grassField.render(elapsedTime, scratchCameraForward, scratchPosition);
    terrain.render(scratchPosition);
    placementEditor?.update();

    renderer.render(scene, chaseCamera.camera);

    perfHUD?.setInstanceCounts({
      grass: grassField.getVisibleInstanceCount(),
      petals: petalTrail.count + 1,
      flowers: flowerField.mesh.count,
    });
    perfHUD?.update(renderer);
  },
);

let perfHUD: import('./debug/PerfHUD').PerfHUD | undefined;
let placementEditor: import('./debug/PlacementEditor').PlacementEditor | undefined;

if (import.meta.env.DEV) {
  const [{ PerfHUD }, { TuningPanel }] = await Promise.all([
    import('./debug/PerfHUD'),
    import('./debug/TuningPanel'),
  ]);
  perfHUD = new PerfHUD();
  new TuningPanel((enabled) => {
    void input.setTiltEnabled(enabled);
  }, renderer);

  // The placement tool (PRD §7.4): dev-only, ?edit=1. It mutates the
  // level's working copy and asks for the flower field to be rebuilt.
  if (new URLSearchParams(window.location.search).get('edit') === '1') {
    const { PlacementEditor } = await import('./debug/PlacementEditor');
    placementEditor = new PlacementEditor({
      level,
      palette,
      camera: chaseCamera.camera,
      terrainGroup: terrain.group,
      scene,
      domElement: renderer.domElement,
      getHeightAt: getGroundHeight,
      getPlayerPose: () => ({ position: windController.position, heading: windController.heading }),
      setSteeringFrozen: (frozen) => input.setSteeringFrozen(frozen),
      onLevelChanged: (changed) => {
        scene.remove(flowerField.mesh);
        flowerField.dispose();
        flowerField = buildFlowerField(flattenFlowers(changed));
        flowerField.onBloom = handleBloom;
      },
    });
  }
}

loop.start();
