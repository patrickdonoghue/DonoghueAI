import * as THREE from 'three';
import { VITALITY } from '../config/tuning';
import type { LevelBounds } from '../player/WindController';

/**
 * The vitality field (PRD §5.4): a single-channel field mapped across the
 * level's XZ bounds. 0 = dead land, 1 = alive. Blooming a flower splats a
 * soft radial gradient into it (additive, clamped); the grass and terrain
 * shaders sample it to lerp colour and height, which is how "colour
 * spreads outward like ink in water" happens with one texture and no
 * per-object state.
 *
 * Implementation note — CPU raster + DataTexture, NOT a render target.
 * The first implementation splatted quads into a WebGLRenderTarget, and
 * readRenderTargetPixels confirmed the data landed — but sampling that
 * target from the grass/terrain shaders silently returned 0 on the
 * development machine's driver (in both vertex AND fragment stages),
 * which cost a long probe session to isolate. Splats are tiny and rare,
 * so rasterising them in plain JS and uploading a DataTexture costs
 * nothing perceptible, gives an identical GPU-side sampling interface,
 * and adds a free CPU-side sampleAt() for vertex-shaped consumers like
 * per-blade grass height. Phase 3b's completion metric can sum the
 * mirror directly instead of mip-reducing a texture.
 */
export class VitalityField {
  readonly texture: THREE.DataTexture;
  /** World XZ of the field's origin and its extent — the shader-side
   *  mapping from world position to field UV. */
  readonly boundsMin: THREE.Vector2;
  readonly boundsSize: THREE.Vector2;

  /** Authoritative field values, row-major, [0, 1]. */
  private readonly mirror: Float32Array;
  private readonly pixels: Uint8Array;

  constructor(bounds: LevelBounds) {
    this.boundsMin = new THREE.Vector2(bounds.min[0], bounds.min[1]);
    this.boundsSize = new THREE.Vector2(
      bounds.max[0] - bounds.min[0],
      bounds.max[1] - bounds.min[1],
    );

    const res = VITALITY.RESOLUTION;
    this.mirror = new Float32Array(res * res); // starts at 0: the level begins dead
    this.pixels = new Uint8Array(res * res * 4);
    // Alpha to 255 once; only RGB get rewritten by splats.
    for (let i = 3; i < this.pixels.length; i += 4) this.pixels[i] = 255;

    this.texture = new THREE.DataTexture(this.pixels, res, res, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    // World-Z maps straight to texture V; no image-style vertical flip.
    this.texture.flipY = false;
    this.texture.needsUpdate = true;
  }

  /** Splat a soft radial gradient of life centred at a world XZ position:
   *  full strength inside SPLAT_CORE of the radius, then a smooth falloff
   *  rim (see the tuning comments for why the flat core exists).
   *  Accumulates additively, clamped at 1. */
  splat(worldX: number, worldZ: number, radius = VITALITY.SPLAT_RADIUS, strength = VITALITY.SPLAT_STRENGTH): void {
    const res = VITALITY.RESOLUTION;
    const cx = ((worldX - this.boundsMin.x) / this.boundsSize.x) * res;
    const cz = ((worldZ - this.boundsMin.y) / this.boundsSize.y) * res;
    const radiusTexels = (radius / this.boundsSize.x) * res;
    const x0 = Math.max(0, Math.floor(cx - radiusTexels));
    const x1 = Math.min(res - 1, Math.ceil(cx + radiusTexels));
    const z0 = Math.max(0, Math.floor(cz - radiusTexels));
    const z1 = Math.min(res - 1, Math.ceil(cz + radiusTexels));

    for (let tz = z0; tz <= z1; tz++) {
      for (let tx = x0; tx <= x1; tx++) {
        const d = Math.hypot(tx + 0.5 - cx, tz + 0.5 - cz) / radiusTexels;
        if (d >= 1) continue;
        const rim = d <= VITALITY.SPLAT_CORE ? 1 : 1 - (d - VITALITY.SPLAT_CORE) / (1 - VITALITY.SPLAT_CORE);
        const smooth = rim * rim * (3 - 2 * rim); // matches a GPU smoothstep edge
        const value = strength * Math.pow(smooth, VITALITY.SPLAT_FALLOFF);
        const index = tz * res + tx;
        const next = Math.min(1, this.mirror[index]! + value);
        this.mirror[index] = next;
        const byte = Math.round(next * 255);
        const p = index * 4;
        this.pixels[p] = byte;
        this.pixels[p + 1] = byte;
        this.pixels[p + 2] = byte;
      }
    }

    this.texture.needsUpdate = true;
  }

  /** Nearest-texel read at a world XZ position — the CPU-side face of the
   *  same field, used for per-blade grass height attributes. */
  sampleAt(worldX: number, worldZ: number): number {
    const res = VITALITY.RESOLUTION;
    const tx = Math.floor(((worldX - this.boundsMin.x) / this.boundsSize.x) * res);
    const tz = Math.floor(((worldZ - this.boundsMin.y) / this.boundsSize.y) * res);
    if (tx < 0 || tz < 0 || tx >= res || tz >= res) return 0;
    return this.mirror[tz * res + tx]!;
  }
}
