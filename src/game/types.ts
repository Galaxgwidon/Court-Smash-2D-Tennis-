export type GameState = 'TITLE_MENU' | 'PLAYING' | 'PAUSED' | 'GAME_OVER';

export type GameMode = 'match' | 'machine';

export type CourtSurface = 'clay' | 'grass' | 'hard';

export type Difficulty = 'anfaenger' | 'club' | 'profi';

export type PointPhase =
  | 'SERVE_WAIT'
  | 'IN_PLAY'
  | 'POINT_OVER';

export type Side = 'player' | 'opponent';

export type ShotQuality = 'PERFEKT' | 'GUT' | 'KNAPP' | 'VOLLEY' | 'AUFSCHLAG';

export interface GameConfig {
  mode: GameMode;
  surface: CourtSurface;
  difficulty: Difficulty;
}

export interface MatchScore {
  playerPoints: number;
  opponentPoints: number;
  playerGames: number;
  opponentGames: number;
  gamesToWin: number;
  server: Side;
}

export interface SessionStats {
  rally: number;
  bestRally: number;
  perfectHits: number;
  totalHits: number;
  topSpeedKmh: number;
  lastSpeedKmh: number;
  machineScore: number;
  bestMachineScore: number;
  targetsHit: number;
  lives: number;
  maxLives: number;
}

export interface HudSnapshot {
  state: GameState;
  config: GameConfig;
  phase: PointPhase;
  score: MatchScore;
  stats: SessionStats;
  winner: Side | null;
  lastCall: string | null;
  playerServingPrompt: boolean;
  muted: boolean;
}

export interface Particle {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  life: number;
  maxLife: number;
  color: string;
  drag: number;
}

export interface FloatingCallout {
  active: boolean;
  x: number;
  y: number;
  vy: number;
  text: string;
  subtext: string;
  color: string;
  life: number;
  maxLife: number;
  scale: number;
}

export interface TargetZone {
  x: number;
  y: number;
  radius: number;
  pulse: number;
  points: number;
  hitFlash: number;
}
