/**
 * palettes.ts — colour definitions per dream.
 *
 * One palette drives the entire look of a level: sky, fog, grass, terrain,
 * flowers, light. Nothing in the renderer should contain a hardcoded colour.
 *
 * Only `meadow-morning` (Dream 1) is defined. The others are v1.0.
 *
 * Note for tuning: these are authored as sRGB hex because that's how they're
 * picked. Convert to linear on load (Three's `Color.setHex(h, SRGBColorSpace)`)
 * and do all shader maths in linear, or the greens will go muddy.
 */

import * as THREE from 'three';

export interface Palette {
  id: string;

  sky: {
    zenith: number;
    horizon: number;
    /** Sun disc and its bloom. */
    sun: number;
    /** Elevation and azimuth in degrees. Low sun means long shadows and
     *  strong grass backlighting — the single biggest lever on mood. */
    sunElevation: number;
    sunAzimuth: number;
    sunIntensity: number;
    /** Sky-as-ambient. Keep reasonably high; this is a bright game. */
    ambientIntensity: number;
  };

  fog: {
    color: number;
    near: number;
    far: number;
    /** Tint applied to distant geometry, on top of fog. Sells depth. */
    aerialTint: number;
    aerialStrength: number;
  };

  clouds: {
    lit: number;
    shadow: number;
    /** 0 = clear, 1 = overcast. Drives billboard layer count and alpha. */
    coverage: number;
  };

  grass: {
    aliveBase: number;
    aliveTip: number;
    deadBase: number;
    deadTip: number;
  };

  terrain: {
    aliveGrass: number;
    deadGrass: number;
    dirt: number;
    rock: number;
  };

  /** Keyed by species id. `degree` indexes AUDIO.SCALE_SEMITONES, so each
   *  species is a fixed note — this is what makes a line of one species
   *  read as a held tone and a mixed cluster read as a chord. */
  flowers: Record<string, { color: number; center: number; degree: number; octave: number }>;

  particles: {
    pollen: number;
    seed: number;
  };

  grade: {
    /** Multiplied into the final image. Use sparingly — grade to taste at
     *  the end, don't compensate for badly chosen source colours here. */
    lift: number;
    gain: number;
    saturation: number;
    /** Positive shifts warm, negative cool. Range roughly -0.2 to 0.2. */
    temperature: number;
  };
}

/**
 * Dream 1 — mid-morning meadow.
 *
 * Direction: clean and awake rather than golden and nostalgic. The sunset
 * palette is Dream 3's job, and spending it here leaves nowhere to go.
 * Sun is at 32° — high enough to feel like morning, low enough that the
 * grass backlights properly when you fly east.
 *
 * The dead palette is desaturated tan-grey rather than brown: it should
 * read as drained, not as dirt. The moment the game has to sell is colour
 * flooding back in, and that contrast is a saturation jump more than a
 * hue change.
 */
export const MEADOW_MORNING: Palette = {
  id: 'meadow-morning',

  sky: {
    zenith: 0x4e8fc4,
    horizon: 0xcfe3ec,
    sun: 0xfff4d6,
    sunElevation: 32,
    sunAzimuth: 118,
    sunIntensity: 1.15,
    ambientIntensity: 0.55,
  },

  fog: {
    color: 0xc9dde6,
    near: 60,
    far: 340,
    aerialTint: 0x9fc4dd,
    aerialStrength: 0.35,
  },

  clouds: {
    lit: 0xfdfbf6,
    shadow: 0xb9cbd6,
    coverage: 0.35,
  },

  grass: {
    aliveBase: 0x3f6b2e,
    aliveTip: 0x8fbf4a,
    deadBase: 0x5c5648,
    deadTip: 0x9c927a,
  },

  terrain: {
    aliveGrass: 0x4a6b33,
    deadGrass: 0x7a7160,
    dirt: 0x6b5b45,
    rock: 0x8c8578,
  },

  flowers: {
    pink: { color: 0xf2a0c4, center: 0xfff2dc, degree: 0, octave: 0 },
    yellow: { color: 0xf5d061, center: 0xffffff, degree: 1, octave: 0 },
    white: { color: 0xfbf6ee, center: 0xf5d061, degree: 2, octave: 0 },
    /** Hidden flowers. Distinct hue, distinct note — a fifth up and an
     *  octave above, so finding one is audibly an event. */
    lavender: { color: 0xb9a6e0, center: 0xfff2dc, degree: 3, octave: 1 },
  },

  particles: {
    pollen: 0xfff0b8,
    seed: 0xf3ead6,
  },

  grade: {
    lift: 0.01,
    gain: 1.03,
    saturation: 1.08,
    temperature: 0.04,
  },
};

export const PALETTES: Record<string, Palette> = {
  'meadow-morning': MEADOW_MORNING,
  // 'valley-gold':  Dream 2 — v1.0
  // 'night-lamps':  Dream 3 — v1.0
};

export function getPalette(id: string): Palette {
  const p = PALETTES[id];
  if (!p) throw new Error(`Unknown palette: ${id}`);
  return p;
}

/** Converts one of this file's sRGB hex colours into a THREE.Color in the
 *  renderer's linear working space — see the file header note. Every
 *  system that reads a palette colour should go through this, not
 *  `new THREE.Color(hex)` directly, so a missed conversion doesn't quietly
 *  produce muddy greens. */
export function paletteColor(hex: number): THREE.Color {
  return new THREE.Color().setHex(hex, THREE.SRGBColorSpace);
}
