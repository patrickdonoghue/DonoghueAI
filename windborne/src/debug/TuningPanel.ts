import { Pane } from 'tweakpane';
import { CAMERA, FLIGHT, INPUT } from '../config/tuning';

/**
 * Dev-only tweakpane panel wired directly to the tuning.ts constant
 * objects, so Patrick can tune feel live without touching code. Dynamic-
 * imported from main.ts behind `import.meta.env.DEV` so tweakpane and this
 * module never reach a production bundle.
 */
export class TuningPanel {
  private readonly pane: Pane;
  private readonly tiltState = { enabled: false };

  constructor(onSetTiltEnabled: (enabled: boolean) => void) {
    this.pane = new Pane({ title: 'Windborne — tuning', expanded: true });

    const flight = this.pane.addFolder({ title: 'Flight' });
    flight.addBinding(FLIGHT, 'BASE_SPEED', { min: 2, max: 40, step: 0.1 });
    flight.addBinding(FLIGHT, 'BOOST_GAIN', { min: 0, max: 2, step: 0.01 });
    flight.addBinding(FLIGHT, 'PETAL_SPEED_K', { min: 0, max: 0.2, step: 0.001 });
    flight.addBinding(FLIGHT, 'ACCEL_TAU', { min: 0.05, max: 3, step: 0.01 });
    flight.addBinding(FLIGHT, 'DECEL_TAU', { min: 0.05, max: 3, step: 0.01 });
    flight.addBinding(FLIGHT, 'TURN_RATE', { min: 0.1, max: 4, step: 0.01 });
    flight.addBinding(FLIGHT, 'TURN_RATE_AT_MAX', { min: 0.1, max: 4, step: 0.01 });
    flight.addBinding(FLIGHT, 'PITCH_LIMIT', { min: 0, max: Math.PI / 2, step: 0.01, label: 'PITCH_LIMIT (rad)' });
    flight.addBinding(FLIGHT, 'MIN_ALTITUDE', { min: 0, max: 10, step: 0.1 });
    flight.addBinding(FLIGHT, 'ALTITUDE_PUSH_K', { min: 0, max: 60, step: 0.5 });
    flight.addBinding(FLIGHT, 'MAX_ALTITUDE', { min: 20, max: 300, step: 1 });
    flight.addBinding(FLIGHT, 'ALTITUDE_CEILING_K', { min: 0, max: 30, step: 0.5 });
    flight.addBinding(FLIGHT, 'BOUNDARY_MARGIN', { min: 5, max: 100, step: 1 });
    flight.addBinding(FLIGHT, 'BOUNDARY_TURN_K', { min: 0, max: 2, step: 0.01 });
    flight.addBinding(FLIGHT, 'SLOPE_ASSIST', { min: 0, max: 1, step: 0.01 });

    const input = this.pane.addFolder({ title: 'Input', expanded: false });
    input.addBinding(INPUT, 'MOUSE_DEADZONE', { min: 0, max: 0.3, step: 0.01 });
    input.addBinding(INPUT, 'MOUSE_FULL_DEFLECTION', { min: 0.1, max: 1, step: 0.01 });
    input.addBinding(INPUT, 'SMOOTHING_TAU', { min: 0.01, max: 0.5, step: 0.01 });
    input.addBinding(INPUT, 'GAMEPAD_DEADZONE', { min: 0, max: 0.4, step: 0.01 });
    input.addBinding(INPUT, 'TOUCH_FULL_DEFLECTION', { min: 40, max: 300, step: 5 });
    input.addBinding(INPUT, 'TOUCH_BOOST_DRAG', { min: 60, max: 400, step: 5 });
    input.addBinding(INPUT, 'STEER_SPAN', { min: 0.2, max: 3, step: 0.05 });
    input.addBinding(INPUT, 'TILT_FULL_DEFLECTION', { min: 5, max: 45, step: 1 });
    input
      .addBinding(this.tiltState, 'enabled', {
        label: 'tilt (dev toggle — real UI in Phase 6)',
      })
      .on('change', (ev) => onSetTiltEnabled(ev.value));

    const camera = this.pane.addFolder({ title: 'Camera', expanded: false });
    camera.addBinding(CAMERA, 'DISTANCE', { min: 1, max: 20, step: 0.1 });
    camera.addBinding(CAMERA, 'HEIGHT_OFFSET', { min: -5, max: 10, step: 0.1 });
    camera.addBinding(CAMERA, 'POSITION_DAMPING', { min: 0.01, max: 1, step: 0.01 });
    camera.addBinding(CAMERA, 'LOOK_DAMPING', { min: 0.01, max: 1, step: 0.01 });
    camera.addBinding(CAMERA, 'FOV_BASE', { min: 30, max: 100, step: 1 });
    camera.addBinding(CAMERA, 'FOV_FAST', { min: 30, max: 120, step: 1 });
    camera.addBinding(CAMERA, 'FOV_TAU', { min: 0.05, max: 2, step: 0.01 });
    camera.addBinding(CAMERA, 'ROLL_MAX', { min: 0, max: Math.PI / 4, step: 0.01, label: 'ROLL_MAX (rad)' });
    camera.addBinding(CAMERA, 'ROLL_DAMPING', { min: 0.01, max: 1, step: 0.01 });
  }

  dispose(): void {
    this.pane.dispose();
  }
}
