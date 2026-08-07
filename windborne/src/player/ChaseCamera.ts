import * as THREE from 'three';
import { CAMERA, FLIGHT } from '../config/tuning';

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * Chase camera: spring-damped position and look target, speed-driven FOV,
 * and a subtle roll into turns. Runs its damping at the fixed simulation
 * step (the damping constants in tuning.ts assume a 60Hz step) and exposes
 * an interpolated render() for smooth output at any display framerate.
 */
export class ChaseCamera {
  readonly camera: THREE.PerspectiveCamera;

  private readonly dampedPosition = new THREE.Vector3();
  private readonly previousDampedPosition = new THREE.Vector3();
  private readonly dampedLookTarget = new THREE.Vector3();
  private readonly previousDampedLookTarget = new THREE.Vector3();
  private fov = CAMERA.FOV_BASE;
  private previousFov = CAMERA.FOV_BASE;
  private roll = 0;
  private previousRoll = 0;

  private readonly scratchDesiredPosition = new THREE.Vector3();
  private readonly scratchUp = new THREE.Vector3(0, 1, 0);
  private readonly scratchForward = new THREE.Vector3();
  private readonly scratchRolledUp = new THREE.Vector3();
  private readonly scratchAxis = new THREE.Vector3();
  private readonly scratchCross = new THREE.Vector3();
  private readonly scratchAlongAxis = new THREE.Vector3();
  private readonly scratchRenderPosition = new THREE.Vector3();
  private readonly scratchRenderLookTarget = new THREE.Vector3();

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(CAMERA.FOV_BASE, aspect, CAMERA.NEAR, CAMERA.FAR);
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Snaps the damped state to a starting pose, so the first frame doesn't
   *  spring in from the origin. */
  teleport(playerPosition: THREE.Vector3, playerHeading: THREE.Vector3): void {
    this.scratchDesiredPosition
      .copy(playerPosition)
      .addScaledVector(playerHeading, -CAMERA.DISTANCE)
      .addScaledVector(this.scratchUp, CAMERA.HEIGHT_OFFSET);
    this.dampedPosition.copy(this.scratchDesiredPosition);
    this.previousDampedPosition.copy(this.scratchDesiredPosition);
    this.dampedLookTarget.copy(playerPosition);
    this.previousDampedLookTarget.copy(playerPosition);
  }

  fixedUpdate(dt: number, playerPosition: THREE.Vector3, playerHeading: THREE.Vector3, steerYaw: number, speed: number): void {
    this.previousDampedPosition.copy(this.dampedPosition);
    this.previousDampedLookTarget.copy(this.dampedLookTarget);
    this.previousFov = this.fov;
    this.previousRoll = this.roll;

    this.scratchDesiredPosition
      .copy(playerPosition)
      .addScaledVector(playerHeading, -CAMERA.DISTANCE)
      .addScaledVector(this.scratchUp, CAMERA.HEIGHT_OFFSET);
    this.dampedPosition.lerp(this.scratchDesiredPosition, CAMERA.POSITION_DAMPING);

    // Looking directly at the player (the lead petal) rather than ahead of
    // it — the lag comes entirely from the damping, not a lookahead offset.
    this.dampedLookTarget.lerp(playerPosition, CAMERA.LOOK_DAMPING);

    const fovReference = FLIGHT.BASE_SPEED * FLIGHT.BOOST_GAIN;
    const fovT = fovReference > 0 ? clamp((speed - FLIGHT.BASE_SPEED) / fovReference, 0, 1) : 0;
    const targetFov = THREE.MathUtils.lerp(CAMERA.FOV_BASE, CAMERA.FOV_FAST, fovT);
    this.fov += (targetFov - this.fov) * (1 - Math.exp(-dt / CAMERA.FOV_TAU));

    const targetRoll = -steerYaw * CAMERA.ROLL_MAX;
    this.roll += (targetRoll - this.roll) * CAMERA.ROLL_DAMPING;
  }

  render(alpha: number): void {
    this.scratchRenderPosition.copy(this.previousDampedPosition).lerp(this.dampedPosition, alpha);
    this.scratchRenderLookTarget.copy(this.previousDampedLookTarget).lerp(this.dampedLookTarget, alpha);
    const fov = THREE.MathUtils.lerp(this.previousFov, this.fov, alpha);
    const roll = THREE.MathUtils.lerp(this.previousRoll, this.roll, alpha);

    this.camera.position.copy(this.scratchRenderPosition);
    this.camera.up.copy(this.rollUpVector(roll));
    this.camera.lookAt(this.scratchRenderLookTarget);

    if (this.camera.fov !== fov) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Rotates the world-up vector around the camera's forward axis by
   *  `roll` radians, via Rodrigues' rotation formula, so lookAt() produces
   *  a rolled camera without a separate post-lookAt rotation step. */
  private rollUpVector(roll: number): THREE.Vector3 {
    if (Math.abs(roll) < 1e-6) return this.scratchUp;

    this.scratchForward.copy(this.scratchRenderLookTarget).sub(this.scratchRenderPosition).normalize();
    this.scratchAxis.copy(this.scratchForward);

    const cos = Math.cos(roll);
    const sin = Math.sin(roll);
    this.scratchCross.crossVectors(this.scratchAxis, this.scratchUp).multiplyScalar(sin);
    this.scratchAlongAxis.copy(this.scratchAxis).multiplyScalar(this.scratchAxis.dot(this.scratchUp) * (1 - cos));

    this.scratchRolledUp
      .copy(this.scratchUp)
      .multiplyScalar(cos)
      .add(this.scratchCross)
      .add(this.scratchAlongAxis)
      .normalize();
    return this.scratchRolledUp;
  }
}
