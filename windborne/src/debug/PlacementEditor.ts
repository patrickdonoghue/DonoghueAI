import * as THREE from 'three';
import { EDITOR } from '../config/tuning';
import type { LevelData } from '../level/LevelLoader';
import type { Palette } from '../config/palettes';

/**
 * The placement tool (PRD §7.4) — dev-only, activated with ?edit=1,
 * dynamically imported so production builds never see it.
 *
 * Flower placement is the level design and the game's only signage, so it
 * is authored in-engine at flight speed: you keep flying while you place.
 * The mouse both steers and aims — pointing at the spot you want a flower
 * also carries you toward it, which sounds like a conflict and in practice
 * is the workflow (you paint along your own flight line).
 *
 * The tool authors GEOMETRY only: flowers, clusters, props, spawn, exit.
 * Event blocks (`onComplete`) are hand-written JSON afterwards — no event
 * UI, per the spec's explicit split of responsibilities.
 *
 * Keys: 1–4 species · F drop at cursor · Shift+drag paint line ·
 * [ / ] line spacing · C open/close cluster · P prop (Tab cycles type) ·
 * S spawn at player · X exit at cursor · Backspace undo · Ctrl+S save.
 */

export interface EditorContext {
  level: LevelData;
  palette: Palette;
  camera: THREE.Camera;
  /** Terrain meshes for the cursor raycast. */
  terrainGroup: THREE.Group;
  scene: THREE.Scene;
  domElement: HTMLElement;
  getHeightAt: (x: number, z: number) => number;
  getPlayerPose: () => { position: THREE.Vector3; heading: THREE.Vector3 };
  /** Called after every mutation so main.ts can rebuild the FlowerField. */
  onLevelChanged: (level: LevelData) => void;
  /** Freeze/unfreeze flight steering — held while a paint stroke is
   *  active so the brush hand doesn't double as the rudder hand. */
  setSteeringFrozen: (frozen: boolean) => void;
}

const PROP_TYPES = ['dead-tree'] as const;
const DEFAULT_LINE_SPACING = 4.5;
const MIN_SPACING = 1.5;
const MAX_SPACING = 12;

type UndoAction =
  | { kind: 'add-flowers'; clusterId: string; count: number }
  | { kind: 'add-prop' }
  | { kind: 'spawn'; prev: LevelData['spawn'] }
  | { kind: 'exit'; prev: LevelData['exit'] };

export class PlacementEditor {
  private readonly ctx: EditorContext;
  private readonly speciesIds: string[];
  private speciesIndex = 0;
  private lineSpacing = DEFAULT_LINE_SPACING;
  private openClusterId: string | null = null;
  private clusterCounter: number;
  private propIndex = 0;
  private unsaved = false;

  private readonly undoStack: UndoAction[] = [];

  // Cursor raycast state, refreshed per pointermove.
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointerNdc = new THREE.Vector2();
  private cursorValid = false;
  private readonly cursorPoint = new THREE.Vector3();

  // Shift+drag painting state. Shift is tracked from key events as well
  // as read off the pointer event — some input paths (automation, certain
  // trackpad drivers) deliver drags whose pointer events lack the
  // modifier flag even while the key is held.
  private painting = false;
  private paintCount = 0;
  private shiftHeld = false;
  private readonly lastPlaced = new THREE.Vector3();

  // In-scene helpers: cursor disc, spawn arrow, exit ring.
  private readonly helpers = new THREE.Group();
  private readonly cursorMarker: THREE.Mesh;
  private readonly spawnMarker: THREE.Mesh;
  private readonly exitMarker: THREE.Mesh;

  private readonly overlay: HTMLDivElement;

  constructor(ctx: EditorContext) {
    this.ctx = ctx;
    this.speciesIds = Object.keys(ctx.palette.flowers);
    // Continue cluster numbering past whatever the file already has, so
    // authoring across sessions never collides ids.
    this.clusterCounter = ctx.level.clusters.length;

    // Markers are deliberately crude — they're editor chrome, not art.
    this.cursorMarker = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 0.7, 24),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthTest: false }),
    );
    this.cursorMarker.rotation.x = -Math.PI / 2;
    this.spawnMarker = new THREE.Mesh(
      new THREE.ConeGeometry(0.6, 1.6, 8),
      new THREE.MeshBasicMaterial({ color: 0x66ccff, wireframe: true }),
    );
    this.exitMarker = new THREE.Mesh(
      new THREE.TorusGeometry(2.2, 0.15, 8, 32),
      new THREE.MeshBasicMaterial({ color: 0xffe37a, wireframe: true }),
    );
    this.helpers.add(this.cursorMarker, this.spawnMarker, this.exitMarker);
    ctx.scene.add(this.helpers);
    this.syncMarkers();

    this.overlay = document.createElement('div');
    this.overlay.style.cssText =
      'position:fixed;left:12px;bottom:12px;z-index:20;font:12px/1.6 monospace;' +
      'color:#eee;background:rgba(20,24,20,0.82);padding:10px 12px;border-radius:6px;' +
      'pointer-events:none;white-space:pre;';
    document.body.appendChild(this.overlay);
    this.renderOverlay();

    ctx.domElement.addEventListener('pointermove', this.onPointerMove);
    ctx.domElement.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('beforeunload', this.onBeforeUnload);
  }

  /** Per-frame: keep the cursor disc glued to the terrain under the mouse
   *  (the camera moves constantly, so the ray must re-run even when the
   *  mouse doesn't) and lay flowers while a paint drag is active. */
  update(): void {
    this.recastCursor();
    this.cursorMarker.visible = this.cursorValid;
    if (this.cursorValid) {
      this.cursorMarker.position.copy(this.cursorPoint);
      this.cursorMarker.position.y += 0.05;
    }
    if (this.painting) this.tryPaintAtCursor();
  }

  /** Lay a flower at the cursor if the stroke has advanced a full spacing
   *  step since the last one. Shared by pointermove and update(). */
  private tryPaintAtCursor(): void {
    this.recastCursor();
    if (!this.cursorValid) return;
    if (this.paintCount === 0 || this.lastPlaced.distanceTo(this.cursorPoint) >= this.lineSpacing) {
      this.dropFlowerAtCursor(/* extendPaint */ true);
    }
  }

  dispose(): void {
    if (this.painting) this.ctx.setSteeringFrozen(false);
    this.ctx.domElement.removeEventListener('pointermove', this.onPointerMove);
    this.ctx.domElement.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('beforeunload', this.onBeforeUnload);
    this.ctx.scene.remove(this.helpers);
    this.overlay.remove();
  }

  // -------------------------------------------------------------------
  // Input
  // -------------------------------------------------------------------

  private readonly onPointerMove = (event: PointerEvent): void => {
    const rect = this.ctx.domElement.getBoundingClientRect();
    this.pointerNdc.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    // Paint per pointer event as well as per frame — a fast stroke can
    // deliver its whole path between two animation frames, and sampling
    // only in update() would drop it entirely.
    if (this.painting) this.tryPaintAtCursor();
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    if ((event.shiftKey || this.shiftHeld) && event.button === 0) {
      this.painting = true;
      this.paintCount = 0;
      this.ctx.setSteeringFrozen(true);
      this.tryPaintAtCursor();
    }
  };

  private readonly onPointerUp = (): void => {
    if (this.painting) {
      this.ctx.setSteeringFrozen(false);
      if (this.paintCount > 0) {
        // One undo step per painted line, not per flower — undoing a line
        // one blossom at a time is busywork.
        this.undoStack.push({ kind: 'add-flowers', clusterId: this.currentClusterId(), count: this.paintCount });
      }
    }
    this.painting = false;
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (event.key === 'Shift') this.shiftHeld = false;
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Shift') {
      this.shiftHeld = true;
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void this.save();
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    switch (event.key) {
      case '1':
      case '2':
      case '3':
      case '4': {
        const index = Number(event.key) - 1;
        if (index < this.speciesIds.length) this.speciesIndex = index;
        break;
      }
      case 'f':
      case 'F':
        if (this.cursorValid) {
          this.dropFlowerAtCursor(false);
          this.undoStack.push({ kind: 'add-flowers', clusterId: this.currentClusterId(), count: 1 });
        }
        break;
      case '[':
        this.lineSpacing = Math.max(MIN_SPACING, this.lineSpacing - 0.5);
        break;
      case ']':
        this.lineSpacing = Math.min(MAX_SPACING, this.lineSpacing + 0.5);
        break;
      case 'c':
      case 'C':
        if (this.openClusterId) {
          this.openClusterId = null;
        } else {
          this.clusterCounter++;
          this.openClusterId = `cluster-${this.clusterCounter}`;
        }
        break;
      case 'p':
      case 'P':
        if (this.cursorValid) this.placeProp();
        break;
      case 'Tab':
        event.preventDefault();
        this.propIndex = (this.propIndex + 1) % PROP_TYPES.length;
        break;
      case 's':
      case 'S':
        this.setSpawnToPlayer();
        break;
      case 'x':
      case 'X':
        if (this.cursorValid) this.setExitAtCursor();
        break;
      case 'Backspace':
        event.preventDefault();
        this.undo();
        break;
      default:
        return;
    }
    this.renderOverlay();
  };

  private readonly onBeforeUnload = (event: BeforeUnloadEvent): void => {
    if (this.unsaved) event.preventDefault();
  };

  // -------------------------------------------------------------------
  // Placement
  // -------------------------------------------------------------------

  private recastCursor(): void {
    this.raycaster.setFromCamera(this.pointerNdc, this.ctx.camera);
    const hits = this.raycaster.intersectObject(this.ctx.terrainGroup, true);
    const hit = hits[0];
    if (hit) {
      this.cursorPoint.copy(hit.point);
      // Snap to the analytic height — the mesh is an LOD approximation.
      this.cursorPoint.y = this.ctx.getHeightAt(hit.point.x, hit.point.z);
      this.cursorValid = true;
    } else {
      this.cursorValid = false;
    }
  }

  private currentClusterId(): string {
    return this.openClusterId ?? 'unclustered';
  }

  private dropFlowerAtCursor(extendPaint: boolean): void {
    const clusterId = this.currentClusterId();
    let cluster = this.ctx.level.clusters.find((c) => c.id === clusterId);
    if (!cluster) {
      cluster = { id: clusterId, flowers: [] };
      this.ctx.level.clusters.push(cluster);
    }
    // Named clusters cap out (EDITOR.CLUSTER_FLOWER_LIMIT): a paint stroke
    // stops placing at the limit, so one drag lays one line's worth. The
    // overlay flips to FULL — close with C and open the next cluster.
    if (this.openClusterId && cluster.flowers.length >= EDITOR.CLUSTER_FLOWER_LIMIT) {
      this.renderOverlay();
      return;
    }
    cluster.flowers.push({
      pos: [round2(this.cursorPoint.x), round2(this.cursorPoint.z)],
      species: this.speciesIds[this.speciesIndex] ?? 'pink',
    });
    if (extendPaint) {
      this.paintCount++;
      this.lastPlaced.copy(this.cursorPoint);
    }
    this.markChanged();
  }

  private placeProp(): void {
    this.ctx.level.props.push({
      type: PROP_TYPES[this.propIndex] ?? 'dead-tree',
      pos: [round2(this.cursorPoint.x), round2(this.cursorPoint.z)],
      ...(this.openClusterId ? { cluster: this.openClusterId } : {}),
    });
    this.undoStack.push({ kind: 'add-prop' });
    this.markChanged();
  }

  private setSpawnToPlayer(): void {
    const prev = structuredClone(this.ctx.level.spawn);
    const pose = this.ctx.getPlayerPose();
    const headingDeg = THREE.MathUtils.radToDeg(Math.atan2(pose.heading.x, pose.heading.z));
    this.ctx.level.spawn = {
      position: [round2(pose.position.x), round2(pose.position.y), round2(pose.position.z)],
      heading: Math.round(headingDeg),
    };
    this.undoStack.push({ kind: 'spawn', prev });
    this.markChanged();
  }

  private setExitAtCursor(): void {
    const prev = this.ctx.level.exit ? structuredClone(this.ctx.level.exit) : null;
    this.ctx.level.exit = {
      pos: [round2(this.cursorPoint.x), round2(this.cursorPoint.z)],
      requires: this.ctx.level.exit?.requires ?? { vitality: 0.8 },
    };
    this.undoStack.push({ kind: 'exit', prev });
    this.markChanged();
  }

  private undo(): void {
    const action = this.undoStack.pop();
    if (!action) return;
    switch (action.kind) {
      case 'add-flowers': {
        const cluster = this.ctx.level.clusters.find((c) => c.id === action.clusterId);
        if (cluster) cluster.flowers.splice(cluster.flowers.length - action.count, action.count);
        break;
      }
      case 'add-prop':
        this.ctx.level.props.pop();
        break;
      case 'spawn':
        this.ctx.level.spawn = action.prev;
        break;
      case 'exit':
        this.ctx.level.exit = action.prev;
        break;
    }
    this.markChanged();
  }

  private async save(): Promise<void> {
    // Empty clusters are authoring debris (opened, never used, or fully
    // undone) — drop them from the file, not from the working copy.
    const toSave = {
      ...this.ctx.level,
      clusters: this.ctx.level.clusters.filter((c) => c.flowers.length > 0),
    };
    try {
      const response = await fetch('/__windborne/save-level', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toSave),
      });
      if (!response.ok) throw new Error(await response.text());
      this.unsaved = false;
      this.renderOverlay();
      // Vite hot-reloads the page when the JSON changes; nothing to do.
    } catch (error) {
      this.overlay.textContent = `SAVE FAILED: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  // -------------------------------------------------------------------
  // Presentation
  // -------------------------------------------------------------------

  private markChanged(): void {
    this.unsaved = true;
    this.ctx.onLevelChanged(this.ctx.level);
    this.syncMarkers();
    this.renderOverlay();
  }

  private syncMarkers(): void {
    const spawn = this.ctx.level.spawn;
    this.spawnMarker.position.set(spawn.position[0], spawn.position[1], spawn.position[2]);
    if (this.ctx.level.exit) {
      const [x, z] = this.ctx.level.exit.pos;
      this.exitMarker.position.set(x, this.ctx.getHeightAt(x, z) + 2.5, z);
      this.exitMarker.visible = true;
    } else {
      this.exitMarker.visible = false;
    }
  }

  private renderOverlay(): void {
    const species = this.speciesIds[this.speciesIndex] ?? '?';
    const color = this.ctx.palette.flowers[species]?.color ?? 0xffffff;
    const total = this.ctx.level.clusters.reduce((sum, c) => sum + c.flowers.length, 0);
    let open = '—';
    if (this.openClusterId) {
      const count = this.ctx.level.clusters.find((c) => c.id === this.openClusterId)?.flowers.length ?? 0;
      const full = count >= EDITOR.CLUSTER_FLOWER_LIMIT ? ' FULL' : '';
      open = `${this.openClusterId} (${count}/${EDITOR.CLUSTER_FLOWER_LIMIT}${full})`;
    }
    const swatch = `#${color.toString(16).padStart(6, '0')}`;
    this.overlay.innerHTML =
      `<span style="display:inline-block;width:10px;height:10px;background:${swatch};margin-right:6px"></span>` +
      `EDIT  species: ${species}\n` +
      `cluster: ${open}\n` +
      `flowers: ${total}   spacing: ${this.lineSpacing.toFixed(1)}m\n` +
      `${this.unsaved ? '● unsaved' : '  saved'}`;
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
