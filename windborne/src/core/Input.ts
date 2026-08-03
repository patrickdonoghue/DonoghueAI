import * as THREE from 'three';
import { INPUT } from '../config/tuning';

export interface InputState {
  /** World-space unit vector: where the player wants to head, expressed
   *  relative to the current camera view. WindController chases this at a
   *  capped angular rate — it is a target, not a command. */
  desiredDirection: THREE.Vector3;
  /** 0..1, analog where the device supports it. */
  boost: number;
  /** Smoothed steering input on the horizontal axis, -1..1. Exposed
   *  separately from desiredDirection because ChaseCamera uses it to
   *  drive roll — rolling off the *result* (desiredDirection) would roll
   *  even when centred, since desiredDirection tracks the camera. */
  steerYaw: number;
}

interface TouchPoint {
  startX: number;
  startY: number;
  x: number;
  y: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * Unified input: reads mouse, keyboard, gamepad, touch, and (opt-in) device
 * tilt, and merges them into one steering + boost signal per fixed step.
 *
 * Devices are summed rather than switched between. In practice only one
 * device class is ever actually producing nonzero input at a time — an idle
 * gamepad or an idle keyboard contributes (0, 0) — so summing is equivalent
 * to picking-the-active-one without needing explicit priority rules.
 */
export class Input {
  private readonly keys = new Set<string>();

  private mouseX = 0; // -1..1, screen-space, already deadzoned
  private mouseY = 0;
  private mouseBoost = 0;

  private readonly touches = new Map<number, TouchPoint>();

  private tiltEnabled = false;
  private tiltCalibrated = false;
  private tiltBaselineBeta = 0;
  private tiltBaselineGamma = 0;
  private tiltBeta = 0;
  private tiltGamma = 0;
  private tiltBoost = 0;

  private rawYaw = 0;
  private rawPitch = 0;
  private rawBoost = 0;
  private smoothedYaw = 0;
  private smoothedPitch = 0;

  // Scratch, reused every poll() so steering costs zero allocations per step.
  private readonly scratchForward = new THREE.Vector3();
  private readonly scratchRight = new THREE.Vector3();
  private readonly worldUp = new THREE.Vector3(0, 1, 0);

  private readonly state: InputState = {
    desiredDirection: new THREE.Vector3(0, 0, -1),
    boost: 0,
    steerYaw: 0,
  };

  constructor(private readonly domElement: HTMLElement) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    domElement.addEventListener('touchstart', this.onTouchStart, { passive: false });
    domElement.addEventListener('touchmove', this.onTouchMove, { passive: false });
    domElement.addEventListener('touchend', this.onTouchEnd);
    domElement.addEventListener('touchcancel', this.onTouchEnd);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    this.domElement.removeEventListener('touchstart', this.onTouchStart);
    this.domElement.removeEventListener('touchmove', this.onTouchMove);
    this.domElement.removeEventListener('touchend', this.onTouchEnd);
    this.domElement.removeEventListener('touchcancel', this.onTouchEnd);
  }

  /**
   * Device tilt is opt-in and needs a permission prompt on iOS, which must
   * happen from a user gesture. There is no pause-panel toggle yet
   * (that's Phase 6) — TuningPanel exposes a dev checkbox that calls this
   * in the meantime.
   */
  async setTiltEnabled(enabled: boolean): Promise<void> {
    if (!enabled) {
      this.tiltEnabled = false;
      this.tiltCalibrated = false;
      window.removeEventListener('deviceorientation', this.onDeviceOrientation);
      return;
    }

    const DeviceOrientationEventCtor = window.DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<'granted' | 'denied'>;
    };
    if (typeof DeviceOrientationEventCtor.requestPermission === 'function') {
      const result = await DeviceOrientationEventCtor.requestPermission();
      if (result !== 'granted') return;
    }

    this.tiltEnabled = true;
    this.tiltCalibrated = false;
    window.addEventListener('deviceorientation', this.onDeviceOrientation);
  }

  /**
   * Merge every device into one steering + boost signal, then convert
   * steering into a world-space target direction relative to the supplied
   * heading. Called once per fixed step.
   *
   * This must be the flight model's own current heading, not the chase
   * camera's rendered orientation — the camera is purely a lagged,
   * damped function of the heading with no input of its own, so feeding
   * its output back in as the next steering target closes a loop: any
   * transient where the camera lags the player's actual attitude (e.g.
   * catching up after a large altitude change) tips the target off-level,
   * which pulls the heading further off-level, which widens the camera's
   * lag further. On the flat Phase 0 test plane this never had a large
   * transient to seed it; Phase 1's terrain did, and it ran away into a
   * dive. Steering from the heading directly breaks the loop — the camera
   * only ever observes, never feeds back.
   */
  poll(dt: number, heading: THREE.Vector3): InputState {
    this.rawYaw = 0;
    this.rawPitch = 0;
    this.rawBoost = 0;

    this.pollKeyboard();
    this.pollMouse();
    this.pollGamepad();
    this.pollTouch();
    this.pollTilt();

    this.rawYaw = clamp(this.rawYaw, -1, 1);
    this.rawPitch = clamp(this.rawPitch, -1, 1);
    this.rawBoost = clamp(this.rawBoost, 0, 1);

    const smoothing = 1 - Math.exp(-dt / INPUT.SMOOTHING_TAU);
    this.smoothedYaw += (this.rawYaw - this.smoothedYaw) * smoothing;
    this.smoothedPitch += (this.rawPitch - this.smoothedPitch) * smoothing;

    this.scratchForward.copy(heading);
    this.scratchRight.crossVectors(this.scratchForward, this.worldUp).normalize();

    this.state.desiredDirection
      .copy(this.scratchForward)
      .addScaledVector(this.scratchRight, this.smoothedYaw * INPUT.STEER_SPAN)
      .addScaledVector(this.worldUp, this.smoothedPitch * INPUT.STEER_SPAN)
      .normalize();

    this.state.boost = this.rawBoost;
    this.state.steerYaw = this.smoothedYaw;

    return this.state;
  }

  private pollKeyboard(): void {
    let yaw = 0;
    let pitch = 0;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) yaw -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) yaw += 1;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) pitch += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) pitch -= 1;
    this.rawYaw += yaw;
    this.rawPitch += pitch;
    if (this.keys.has('Space')) this.rawBoost = Math.max(this.rawBoost, 1);
  }

  private pollMouse(): void {
    this.rawYaw += this.mouseX;
    this.rawPitch += this.mouseY;
    this.rawBoost = Math.max(this.rawBoost, this.mouseBoost);
  }

  private pollGamepad(): void {
    const pads = navigator.getGamepads?.();
    if (!pads) return;
    for (const pad of pads) {
      if (!pad) continue;
      const x = pad.axes[0] ?? 0;
      const y = pad.axes[1] ?? 0;
      if (Math.abs(x) > INPUT.GAMEPAD_DEADZONE) this.rawYaw += x;
      if (Math.abs(y) > INPUT.GAMEPAD_DEADZONE) this.rawPitch -= y; // stick up is negative y
      // Right trigger is typically axis-like via button.value; A is button 0.
      const trigger = pad.buttons[7]?.value ?? 0;
      const aButton = pad.buttons[0]?.value ?? 0;
      this.rawBoost = Math.max(this.rawBoost, trigger, aButton);
      break; // first connected pad only
    }
  }

  private pollTouch(): void {
    // In tilt mode, touch means tap-to-boost, not drag-to-steer — steering
    // already comes from the device orientation.
    if (this.tiltEnabled) return;
    if (this.touches.size === 0) return;
    // Primary touch steers; a second touch (any) boosts, same as a long drag.
    const [first] = this.touches.values();
    if (!first) return;
    const dx = (first.x - first.startX) / INPUT.TOUCH_FULL_DEFLECTION;
    const dy = (first.y - first.startY) / INPUT.TOUCH_FULL_DEFLECTION;
    this.rawYaw += clamp(dx, -1, 1);
    this.rawPitch -= clamp(dy, -1, 1);

    const dragDistance = Math.hypot(first.x - first.startX, first.y - first.startY);
    if (this.touches.size > 1 || dragDistance > INPUT.TOUCH_BOOST_DRAG) {
      this.rawBoost = Math.max(this.rawBoost, 1);
    }
  }

  private pollTilt(): void {
    if (!this.tiltEnabled || !this.tiltCalibrated) return;
    const dBeta = (this.tiltBeta - this.tiltBaselineBeta) / INPUT.TILT_FULL_DEFLECTION;
    const dGamma = (this.tiltGamma - this.tiltBaselineGamma) / INPUT.TILT_FULL_DEFLECTION;
    this.rawPitch -= clamp(dBeta, -1, 1);
    this.rawYaw += clamp(dGamma, -1, 1);
    this.rawBoost = Math.max(this.rawBoost, this.tiltBoost);
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    this.keys.add(e.code);
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private readonly onMouseMove = (e: MouseEvent): void => {
    const halfW = window.innerWidth / 2;
    const halfH = window.innerHeight / 2;
    const nx = (e.clientX - halfW) / halfH; // normalise by half-height per spec
    const ny = (e.clientY - halfH) / halfH;
    this.mouseX = this.applyDeadzone(nx);
    this.mouseY = -this.applyDeadzone(ny);
  };

  private readonly onMouseDown = (e: MouseEvent): void => {
    if (e.button === 0) this.mouseBoost = 1;
  };

  private readonly onMouseUp = (e: MouseEvent): void => {
    if (e.button === 0) this.mouseBoost = 0;
  };

  private applyDeadzone(v: number): number {
    const mag = Math.abs(v);
    if (mag < INPUT.MOUSE_DEADZONE) return 0;
    const sign = v < 0 ? -1 : 1;
    const scaled = (mag - INPUT.MOUSE_DEADZONE) / (INPUT.MOUSE_FULL_DEFLECTION - INPUT.MOUSE_DEADZONE);
    return sign * clamp(scaled, 0, 1);
  }

  private readonly onTouchStart = (e: TouchEvent): void => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      this.touches.set(t.identifier, { startX: t.clientX, startY: t.clientY, x: t.clientX, y: t.clientY });
    }
    if (this.tiltEnabled) this.tiltBoost = 1;
  };

  private readonly onTouchMove = (e: TouchEvent): void => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      const point = this.touches.get(t.identifier);
      if (point) {
        point.x = t.clientX;
        point.y = t.clientY;
      }
    }
  };

  private readonly onTouchEnd = (e: TouchEvent): void => {
    for (const t of e.changedTouches) {
      this.touches.delete(t.identifier);
    }
    if (this.tiltEnabled && this.touches.size === 0) this.tiltBoost = 0;
  };

  private readonly onDeviceOrientation = (e: DeviceOrientationEvent): void => {
    this.tiltBeta = e.beta ?? 0;
    this.tiltGamma = e.gamma ?? 0;
    if (!this.tiltCalibrated) {
      this.tiltBaselineBeta = this.tiltBeta;
      this.tiltBaselineGamma = this.tiltGamma;
      this.tiltCalibrated = true;
    }
  };
}
