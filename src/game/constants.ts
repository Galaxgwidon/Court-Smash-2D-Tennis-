import type { CourtSurface, Difficulty, MatchScore } from './types';

// Logical world coordinates (centered at 0,0 = center of net)
// Court proportions roughly follow ITF singles ratio (width ~8.23m, length ~23.77m)
// Slightly widened horizontally so 16:9 screens feel grand, readable, and spacious.
export const WORLD = {
  width: 1120,
  height: 760,
  // Playing singles court rectangle
  courtHalfW: 215,
  doublesHalfW: 265,
  courtHalfH: 315,
  serviceLineDist: 162, // distance from net to service line
  netY: 0,
  netHeight: 34,
  gravity: 690,
  ballRadius: 7.5,
  playerRadius: 17,
} as const;

export interface SurfacePalette {
  id: CourtSurface;
  label: string;
  outerColor: string;
  outerDark: string;
  innerColor: string;
  innerStripe: string;
  lineColor: string;
  dustColor: string;
  fenceColor: string;
  bounceDamp: number; // vertical bounce restitution
  speedDamp: number; // horizontal speed retention on bounce
  playerDrag: number; // slightly slidey on clay
}

export const SURFACES: Record<CourtSurface, SurfacePalette> = {
  clay: {
    id: 'clay',
    label: 'Sandplatz',
    outerColor: '#8d4329',
    outerDark: '#743520',
    innerColor: '#c35b34',
    innerStripe: '#ba5530',
    lineColor: '#f8f4ea',
    dustColor: '#e28b63',
    fenceColor: '#223629',
    bounceDamp: 0.79,
    speedDamp: 0.87,
    playerDrag: 9.5,
  },
  grass: {
    id: 'grass',
    label: 'Rasen',
    outerColor: '#244a2c',
    outerDark: '#1c3b23',
    innerColor: '#376f3b',
    innerStripe: '#316535',
    lineColor: '#f7f8f4',
    dustColor: '#a8cf82',
    fenceColor: '#183022',
    bounceDamp: 0.68,
    speedDamp: 0.96,
    playerDrag: 12.5,
  },
  hard: {
    id: 'hard',
    label: 'Hartplatz',
    outerColor: '#254a42',
    outerDark: '#1d3c35',
    innerColor: '#2d5c88',
    innerStripe: '#29547d',
    lineColor: '#f4f7fb',
    dustColor: '#9fc5e8',
    fenceColor: '#1b2b34',
    bounceDamp: 0.75,
    speedDamp: 0.92,
    playerDrag: 13.5,
  },
};

export interface DifficultyProfile {
  id: Difficulty;
  label: string;
  aiMaxSpeed: number;
  aiAccel: number;
  aiReactionDelay: number;
  aiSightDelay: number; // reaction pause right after player strikes
  aiErrorMargin: number;
  aiShotSpeedScale: number;
  aiAngleSpread: number;
  machineBaseSpeed: number;
  machineInterval: number;
}

export const DIFFICULTIES: Record<Difficulty, DifficultyProfile> = {
  anfaenger: {
    id: 'anfaenger',
    label: 'Anfänger',
    aiMaxSpeed: 185,
    aiAccel: 920,
    aiReactionDelay: 0.24,
    aiSightDelay: 0.34,
    aiErrorMargin: 42,
    aiShotSpeedScale: 0.84,
    aiAngleSpread: 0.56,
    machineBaseSpeed: 375,
    machineInterval: 1.3,
  },
  club: {
    id: 'club',
    label: 'Club',
    aiMaxSpeed: 238,
    aiAccel: 1220,
    aiReactionDelay: 0.16,
    aiSightDelay: 0.22,
    aiErrorMargin: 24,
    aiShotSpeedScale: 0.96,
    aiAngleSpread: 0.76,
    machineBaseSpeed: 420,
    machineInterval: 1.05,
  },
  profi: {
    id: 'profi',
    label: 'Profi',
    aiMaxSpeed: 292,
    aiAccel: 1580,
    aiReactionDelay: 0.09,
    aiSightDelay: 0.12,
    aiErrorMargin: 10,
    aiShotSpeedScale: 1.07,
    aiAngleSpread: 0.92,
    machineBaseSpeed: 465,
    machineInterval: 0.85,
  },
};

const TENNIS_POINTS = ['0', '15', '30', '40'] as const;

export function formatPointLabels(score: MatchScore): {
  player: string;
  opponent: string;
  status: string | null;
} {
  const { playerPoints: p, opponentPoints: o } = score;
  if (p >= 3 && o >= 3) {
    if (p === o) {
      return { player: '40', opponent: '40', status: 'Einstand' };
    }
    if (p > o) {
      return { player: 'VT', opponent: '40', status: 'Vorteil Du' };
    }
    return { player: '40', opponent: 'VT', status: 'Vorteil Gegner' };
  }
  return {
    player: TENNIS_POINTS[Math.min(p, 3)],
    opponent: TENNIS_POINTS[Math.min(o, 3)],
    status: null,
  };
}
