import * as THREE from 'three';
import { FLIGHT, PETALS } from '../config/tuning';
import type { InputState } from '../core/Input';

export interface LevelBounds {
  min: readonly [number, number];
  max: readonly [number, number];
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * The flight model. Not a physics body — a steerable current.
 *
 * State is `position`, `heading` (unit vector), and `speed` (scalar), per
 * PRD §5.1. `velocity` is a derived quantity (heading * speed), not stored,
 * because heading and speed have different, independently-tuned response
 * curves (angular chase vs. exponential lerp) that a single velocity vector
 * would blur together.
 *
 * Zero allocation: every vector used in update() is a scratch field,
 * allocated once and reused every step.
 */
export class WindController {
  readonly position = new THREE.Vector3();
  readonly heading = new THREE.Vector3(0, 0, -1);
  speed: number = FLIGHT.BASE_SPEED;
  /** Always 0 until Phase 2 wires up PetalTrail. Kept here because the
   *  speed formula depends on it. */
  petalCount = 0;

  readonly previousPosition = new THREE.Vector3();
  readonly previousHeading = new THREE.Vector3(0, 0, -1);
  previousSpeed: number = FLIGHT.BASE_SPEED;

  // Reference top speed used only to scale the turn-rate falloff — see
  // maxReferenceSpeed(). Not a hard cap on `speed` itself.
  private readonly maxReferenceSpeed =
    FLIGHT.BASE_SPEED * (1 + FLIGHT.BOOST_GAIN) * (1 + FLIGHT.PETAL_SPEED_K * Math.sqrt(PETALS.MAX_PETALS));

  private readonly worldUp = new THREE.Vector3(0, 1, 0);
  private readonly scratchDesired = new THREE.Vector3();
  private readonly scratchToCenter = new THREE.Vector3();
  private readonly scratchVelocity = new THREE.Vector3();
  private readonly scratchAxis = new THREE.Vector3();
  private readonly scratchCross = new THREE.Vector3();
  private readonly scratchAlongAxis = new THREE.Vector3();
  private readonly scratchHorizontal = new THREE.Vector3();

  setPosition(x: number, y: number, z: number): void {
    this.position.set(x, y, z);
    this.previousPosition.copy(this.position);
  }

  setHeading(x: number, y: number, z: number): void {
    this.heading.set(x, y, z).normalize();
    this.previousHeading.copy(this.heading);
  }

  update(
    dt: number,
    input: InputState,
    bounds: LevelBounds,
    getGroundHeight: (x: number, z: number) => number,
  ): void {
    this.previousPosition.copy(this.position);
    this.previousHeading.copy(this.heading);
    this.previousSpeed = this.speed;

    this.scratchDesired.copy(input.desiredDirection);
    this.applyBoundary(this.scratchDesired, bounds);

    const turnFalloff = clamp((this.speed - FLIGHT.BASE_SPEED) / (this.maxReferenceSpeed - FLIGHT.BASE_SPEED), 0, 1);
    const turnRate = THREE.MathUtils.lerp(FLIGHT.TURN_RATE, FLIGHT.TURN_RATE_AT_MAX, turnFalloff);
    this.rotateHeadingToward(this.scratchDesired, turnRate * dt);
    this.clampPitch();

    const petalMultiplier = 1 + FLIGHT.PETAL_SPEED_K * Math.sqrt(this.petalCount);
    const targetSpeed = FLIGHT.BASE_SPEED * (1 + FLIGHT.BOOST_GAIN * input.boost) * petalMultiplier;
    const tau = targetSpeed > this.speed ? FLIGHT.ACCEL_TAU : FLIGHT.DECEL_TAU;
    this.speed += (targetSpeed - this.speed) * (1 - Math.exp(-dt / tau));

    this.scratchVelocity.copy(this.heading).multiplyScalar(this.speed);
    this.applyAltitudeAssist(getGroundHeight);
    this.applySlopeAssist(dt, getGroundHeight);

    this.position.addScaledVector(this.scratchVelocity, dt);
  }

  getInterpolatedPosition(alpha: number, out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.previousPosition).lerp(this.position, alpha);
  }

  getInterpolatedHeading(alpha: number, out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.previousHeading).lerp(this.heading, alpha).normalize();
  }

  getInterpolatedSpeed(alpha: number): number {
    return THREE.MathUtils.lerp(this.previousSpeed, this.speed, alpha);
  }

  /** Blends the desired direction toward the level centre as the player
   *  nears the edge, so the turn-rate limiter above produces a visible
   *  curve back inward rather than a snap. */
  private applyBoundary(desired: THREE.Vector3, bounds: LevelBounds): void {
    const marginX = Math.min(this.position.x - bounds.min[0], bounds.max[0] - this.position.x);
    const marginZ = Math.min(this.position.z - bounds.min[1], bounds.max[1] - this.position.z);
    const margin = Math.min(marginX, marginZ);
    if (margin >= FLIGHT.BOUNDARY_MARGIN) return;

    const centerX = (bounds.min[0] + bounds.max[0]) / 2;
    const centerZ = (bounds.min[1] + bounds.max[1]) / 2;
    this.scratchToCenter.set(centerX - this.position.x, 0, centerZ - this.position.z).normalize();

    const proximity = 1 - clamp(margin / FLIGHT.BOUNDARY_MARGIN, 0, 1);
    desired.lerp(this.scratchToCenter, proximity * FLIGHT.BOUNDARY_TURN_K).normalize();
  }

  /** Rotates `heading` toward `target` by at most `maxAngle` radians, via
   *  Rodrigues' rotation formula around the heading×target axis. */
  private rotateHeadingToward(target: THREE.Vector3, maxAngle: number): void {
    const cosAngle = clamp(this.heading.dot(target), -1, 1);
    const angle = Math.acos(cosAngle);
    if (angle < 1e-6 || maxAngle <= 0) return;

    this.scratchAxis.crossVectors(this.heading, target);
    if (this.scratchAxis.lengthSq() < 1e-8) {
      // heading and target are exactly (or nearly) opposite, so any
      // perpendicular axis technically reaches the target — but not any
      // perpendicular axis LOOKS right. Turning around by rotating around
      // an arbitrary horizontal axis pitches the nose through vertical
      // (a loop); rotating around world-up instead turns it around in
      // the horizontal plane (a U-turn), which is what a reversal should
      // look like. This is always well-defined here because PITCH_LIMIT
      // keeps heading at most 70° from horizontal, so it's never
      // parallel to world-up.
      this.scratchAxis.copy(this.worldUp);
    }
    this.scratchAxis.normalize();

    const rotAngle = Math.min(angle, maxAngle);
    const cos = Math.cos(rotAngle);
    const sin = Math.sin(rotAngle);

    this.scratchCross.crossVectors(this.scratchAxis, this.heading).multiplyScalar(sin);
    this.scratchAlongAxis.copy(this.scratchAxis).multiplyScalar(this.scratchAxis.dot(this.heading) * (1 - cos));

    this.heading.multiplyScalar(cos).add(this.scratchCross).add(this.scratchAlongAxis).normalize();
  }

  private clampPitch(): void {
    const maxSin = Math.sin(FLIGHT.PITCH_LIMIT);
    if (Math.abs(this.heading.y) <= maxSin) return;

    const horizontalTarget = Math.sqrt(Math.max(0, 1 - maxSin * maxSin));
    const horizontalLen = Math.hypot(this.heading.x, this.heading.z);
    if (horizontalLen > 1e-6) {
      const scale = horizontalTarget / horizontalLen;
      this.heading.x *= scale;
      this.heading.z *= scale;
    }
    this.heading.y = this.heading.y < 0 ? -maxSin : maxSin;
    this.heading.normalize();
  }

  private applyAltitudeAssist(getGroundHeight: (x: number, z: number) => number): void {
    const groundHeight = getGroundHeight(this.position.x, this.position.z);
    const altitude = this.position.y - groundHeight;
    if (altitude < FLIGHT.MIN_ALTITUDE) {
      this.scratchVelocity.y += FLIGHT.ALTITUDE_PUSH_K * (FLIGHT.MIN_ALTITUDE - altitude);
    } else if (this.position.y > FLIGHT.MAX_ALTITUDE) {
      this.scratchVelocity.y -= FLIGHT.ALTITUDE_CEILING_K * (this.position.y - FLIGHT.MAX_ALTITUDE);
    }
  }

  /** Slight downhill acceleration, uphill drag. On the flat Phase 0 plane
   *  the ground gradient is always zero, so this is a correctly-inert
   *  no-op until Phase 1 terrain gives getGroundHeight real slopes. */
  private applySlopeAssist(dt: number, getGroundHeight: (x: number, z: number) => number): void {
    const slopeAssist: number = FLIGHT.SLOPE_ASSIST;
    if (slopeAssist === 0) return;

    this.scratchHorizontal.set(this.heading.x, 0, this.heading.z);
    if (this.scratchHorizontal.lengthSq() < 1e-6) return;
    this.scratchHorizontal.normalize();

    const sampleDistance = 0.5;
    const ahead = getGroundHeight(
      this.position.x + this.scratchHorizontal.x * sampleDistance,
      this.position.z + this.scratchHorizontal.z * sampleDistance,
    );
    const behind = getGroundHeight(
      this.position.x - this.scratchHorizontal.x * sampleDistance,
      this.position.z - this.scratchHorizontal.z * sampleDistance,
    );
    const gradient = (ahead - behind) / (2 * sampleDistance);
    this.speed = Math.max(0, this.speed - gradient * slopeAssist * dt * 10);
  }
}
