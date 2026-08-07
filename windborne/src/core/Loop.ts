import { PERF } from '../config/tuning';

/**
 * Fixed-step simulation with interpolated rendering.
 *
 * `fixedUpdate` runs at PERF.FIXED_TIMESTEP regardless of display framerate,
 * so flight feel is identical on a 60Hz and a 144Hz monitor. `render` runs
 * once per animation frame and receives `alpha`, the fraction of the way
 * between the last two fixed steps — consumers lerp their own previous/
 * current state by this to avoid simulation-rate stutter.
 */
export class Loop {
  private accumulator = 0;
  private lastTimeSeconds = 0;
  private running = false;
  private rafHandle = 0;

  constructor(
    private readonly fixedUpdate: (dt: number) => void,
    private readonly render: (alpha: number) => void,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTimeSeconds = performance.now() / 1000;
    this.rafHandle = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafHandle);
  }

  private readonly tick = (nowMs: number): void => {
    if (!this.running) return;

    const now = nowMs / 1000;
    let frameTime = now - this.lastTimeSeconds;
    this.lastTimeSeconds = now;

    // A tab-switch or debugger pause can produce a huge frameTime. Cap it so
    // the accumulator doesn't demand a catch-up spiral of fixed steps.
    const maxFrameTime = PERF.FIXED_TIMESTEP * PERF.MAX_STEPS_PER_FRAME;
    if (frameTime > maxFrameTime) frameTime = maxFrameTime;

    this.accumulator += frameTime;

    let steps = 0;
    while (this.accumulator >= PERF.FIXED_TIMESTEP && steps < PERF.MAX_STEPS_PER_FRAME) {
      this.fixedUpdate(PERF.FIXED_TIMESTEP);
      this.accumulator -= PERF.FIXED_TIMESTEP;
      steps++;
    }

    const alpha = this.accumulator / PERF.FIXED_TIMESTEP;
    this.render(alpha);

    this.rafHandle = requestAnimationFrame(this.tick);
  };
}
