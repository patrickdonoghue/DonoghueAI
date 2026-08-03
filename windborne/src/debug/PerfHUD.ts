import * as THREE from 'three';

const HISTORY_SIZE = 300; // 5s at 60fps
const REFRESH_INTERVAL = 0.25; // seconds; the HUD's own DOM writes don't need per-frame refresh

/**
 * Dev-only performance overlay: frame time (rolling average + 1% worst),
 * draw calls / triangles / programs, instance counts by system, and the
 * current quality tier. Toggle with the backtick key.
 *
 * Built in Phase 0 per CLAUDE.md — subjective acceptance criteria need
 * instrumentation to check the numeric ones, and retrofitting this later
 * would mean re-touching every system that should report into it.
 */
export class PerfHUD {
  private readonly root: HTMLDivElement;
  private visible = true;

  private readonly frameTimesMs = new Float32Array(HISTORY_SIZE);
  private readonly sortScratch = new Float32Array(HISTORY_SIZE);
  private frameTimeCount = 0;
  private frameTimeCursor = 0;
  private lastFrameTimestamp = performance.now();
  private timeSinceRefresh = 0;

  private instanceCounts: Record<string, number> = {};
  /** Real tier detection (auto-demote on sustained low fps) lands in
   *  Phase 6. This readout exists now so the HUD doesn't need retrofitting
   *  when that system arrives. */
  private qualityTier = 'high (detection not yet implemented)';

  constructor() {
    this.root = document.createElement('div');
    this.root.style.position = 'fixed';
    this.root.style.top = '8px';
    this.root.style.left = '8px';
    this.root.style.padding = '8px 10px';
    this.root.style.background = 'rgba(0, 0, 0, 0.6)';
    this.root.style.color = '#c8f0c8';
    this.root.style.font = '12px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    this.root.style.whiteSpace = 'pre';
    this.root.style.pointerEvents = 'none';
    this.root.style.zIndex = '1000';
    this.root.style.borderRadius = '4px';
    document.body.appendChild(this.root);

    window.addEventListener('keydown', this.onKeyDown);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    this.root.remove();
  }

  setInstanceCounts(counts: Record<string, number>): void {
    this.instanceCounts = counts;
  }

  setQualityTier(tier: string): void {
    this.qualityTier = tier;
  }

  /** Call once per rendered frame (not per fixed step). */
  update(renderer: THREE.WebGLRenderer): void {
    const now = performance.now();
    const frameMs = now - this.lastFrameTimestamp;
    this.lastFrameTimestamp = now;

    this.frameTimesMs[this.frameTimeCursor] = frameMs;
    this.frameTimeCursor = (this.frameTimeCursor + 1) % HISTORY_SIZE;
    this.frameTimeCount = Math.min(this.frameTimeCount + 1, HISTORY_SIZE);

    this.timeSinceRefresh += frameMs / 1000;
    if (!this.visible || this.timeSinceRefresh < REFRESH_INTERVAL) return;
    this.timeSinceRefresh = 0;

    const { average, worst1pct } = this.computeFrameTimeStats();
    const info = renderer.info;

    const instanceLines = Object.entries(this.instanceCounts);
    const instanceText =
      instanceLines.length > 0
        ? instanceLines.map(([name, count]) => `  ${name}: ${count.toLocaleString()}`).join('\n')
        : '  (none yet)';

    this.root.textContent =
      `frame: ${average.toFixed(2)}ms avg  ${worst1pct.toFixed(2)}ms 1% worst  (${(1000 / average).toFixed(0)} fps)\n` +
      `draw calls: ${info.render.calls}  triangles: ${info.render.triangles.toLocaleString()}  programs: ${info.programs?.length ?? 0}\n` +
      `instances:\n${instanceText}\n` +
      `quality: ${this.qualityTier}`;
  }

  private computeFrameTimeStats(): { average: number; worst1pct: number } {
    const count = this.frameTimeCount;
    if (count === 0) return { average: 0, worst1pct: 0 };

    let sum = 0;
    for (let i = 0; i < count; i++) {
      const value = this.frameTimesMs[i] ?? 0;
      this.sortScratch[i] = value;
      sum += value;
    }

    const sorted = this.sortScratch.subarray(0, count).sort();
    const worstSampleCount = Math.max(1, Math.ceil(count * 0.01));
    let worstSum = 0;
    for (let i = count - worstSampleCount; i < count; i++) worstSum += sorted[i] ?? 0;

    return { average: sum / count, worst1pct: worstSum / worstSampleCount };
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'Backquote') {
      this.visible = !this.visible;
      this.root.style.display = this.visible ? 'block' : 'none';
    }
  };
}
