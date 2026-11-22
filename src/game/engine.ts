import { tennisAudio } from './audio';
import { DIFFICULTIES, SURFACES, WORLD } from './constants';
import type {
  CourtSurface,
  FloatingCallout,
  GameConfig,
  GameState,
  HudSnapshot,
  MatchScore,
  Particle,
  PointPhase,
  ShotQuality,
  Side,
  SessionStats,
  TargetZone,
} from './types';

interface BallEntity {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  spinX: number; // lateral curve
  lastHitter: Side;
  bouncesOnTargetSide: number;
  firstBounceIn: boolean;
  isPerfectShot: boolean;
  inPlay: boolean;
  trail: Array<{ x: number; y: number; z: number; alpha: number }>;
}

interface AthleteEntity {
  x: number;
  y: number;
  vx: number;
  vy: number;
  facingAngle: number;
  racketSide: 1 | -1; // 1 = right (forehand), -1 = left (backhand)
  swingTimer: number;
  swingDuration: number;
  swingCooldown: number;
  swingBuffer: number;
  swingIsPerfect: boolean;
  stepPhase: number;
  dustTimer: number;
  // AI fields
  aiTargetX: number;
  aiTargetY: number;
  aiReactTimer: number;
  aiWindup: number;
}

interface ScuffMark {
  x: number;
  y: number;
  alpha: number;
  radius: number;
}

const BEST_SCORE_STORAGE_KEY = 'matchball_best_machine_score_v1';

export class TennisEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private onHudUpdate: (snapshot: HudSnapshot) => void;

  private rafId: number | null = null;
  private lastTimestamp = 0;

  private state: GameState = 'TITLE_MENU';
  private config: GameConfig = {
    mode: 'match',
    surface: 'clay',
    difficulty: 'club',
  };

  private phase: PointPhase = 'SERVE_WAIT';
  private phaseTimer = 0.6;
  private winner: Side | null = null;
  private lastCall: string | null = null;

  private score: MatchScore = this.createInitialScore();
  private stats: SessionStats = this.createInitialStats();

  private player: AthleteEntity = this.createAthlete(0, WORLD.courtHalfH - 12);
  private opponent: AthleteEntity = this.createAthlete(0, -WORLD.courtHalfH + 12);
  private ball: BallEntity = this.createBall();

  // Ball machine state
  private machineAngle = Math.PI / 2;
  private machineCharge = 0; // 0..1 telegraph before launch
  private machineCooldown = 0.9;
  private machineFiring = false;
  private machineAimX = 0;
  private machineAimY = 170;
  private targetZone: TargetZone | null = null;
  private machinePointScoredForShot = false;

  // Juice & Visual effects
  private hitstopTimer = 0;
  private shakeTime = 0;
  private shakeIntensity = 0;
  private netRipple = 0;
  private netRippleX = 0;
  private netRipplePhase = 0;
  private courtFlash = 0;

  private particles: Particle[] = [];
  private callouts: FloatingCallout[] = [];
  private scuffs: ScuffMark[] = [];

  // Offscreen court texture cache per surface
  private surfaceCanvasCache: Partial<Record<CourtSurface, HTMLCanvasElement>> = {};

  // Input state (WASD movement + Mouse aiming/acceleration + Left/Right click charge)
  private heldKeys = new Set<string>();
  private mouseWorldX = 0;
  private mouseWorldY = -190;
  private hasMouseMoved = false;
  private mouseSamples: Array<{ x: number; y: number; t: number }> = [];
  private mouseVelX = 0;
  private mouseVelY = 0;
  private peakFlickVx = 0;
  private peakFlickVy = 0;
  private peakAccelBoost = 0; // 0..0.38 from fast mouse acceleration
  private peakFlickTimer = 0;

  private mouseButtonHeld: 'sharp' | 'volley' | null = null;
  private mouseCharge = 0; // 0..1 ramps up the longer Left/Right button is held
  private mouseSwingReleased = false;
  private pendingShot: {
    type: 'sharp' | 'volley';
    charge: number;
    accelBoost: number;
    targetX: number;
    targetY: number;
    flickVx: number;
  } | null = null;

  // Viewport transform cache
  private viewWidth = 1280;
  private viewHeight = 720;
  private dpr = 1;
  private worldScale = 1;
  private worldOffsetX = 640;
  private worldOffsetY = 360;
  private cameraPanX = 0;

  private hudDirty = true;

  constructor(canvas: HTMLCanvasElement, onHudUpdate: (snapshot: HudSnapshot) => void) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('2D Canvas context not available');
    }
    this.ctx = ctx;
    this.onHudUpdate = onHudUpdate;

    // Pre-allocate pools
    for (let i = 0; i < 140; i++) {
      this.particles.push({
        active: false,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        size: 3,
        alpha: 0,
        life: 0,
        maxLife: 0.4,
        color: '#ffffff',
        drag: 0.92,
      });
    }
    for (let i = 0; i < 16; i++) {
      this.callouts.push({
        active: false,
        x: 0,
        y: 0,
        vy: -28,
        text: '',
        subtext: '',
        color: '#ffffff',
        life: 0,
        maxLife: 1,
        scale: 1,
      });
    }

    this.loadBestScore();
    this.handleResize();
    this.initDemoRally();
    this.bindEvents();
    this.emitHud();
  }

  private loadBestScore(): void {
    try {
      const saved = window.localStorage.getItem(BEST_SCORE_STORAGE_KEY);
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!Number.isNaN(parsed) && parsed > 0) {
          this.stats.bestMachineScore = parsed;
        }
      }
    } catch {
      // Ignore storage access restrictions
    }
  }

  private saveBestScore(value: number): void {
    try {
      window.localStorage.setItem(BEST_SCORE_STORAGE_KEY, String(value));
    } catch {
      // Ignore storage access restrictions
    }
  }

  private createInitialScore(): MatchScore {
    return {
      playerPoints: 0,
      opponentPoints: 0,
      playerGames: 0,
      opponentGames: 0,
      gamesToWin: 3,
      // Opponent serves first so the user immediately receives a ball to return!
      server: 'opponent',
    };
  }

  private createInitialStats(): SessionStats {
    const prevBest = this.stats?.bestMachineScore ?? 0;
    return {
      rally: 0,
      bestRally: 0,
      perfectHits: 0,
      totalHits: 0,
      topSpeedKmh: 0,
      lastSpeedKmh: 0,
      machineScore: 0,
      bestMachineScore: prevBest,
      targetsHit: 0,
      lives: 3,
      maxLives: 3,
    };
  }

  private createAthlete(x: number, y: number): AthleteEntity {
    return {
      x,
      y,
      vx: 0,
      vy: 0,
      facingAngle: y > 0 ? -Math.PI / 2 : Math.PI / 2,
      racketSide: 1,
      swingTimer: 0,
      swingDuration: 0.22,
      swingCooldown: 0,
      swingBuffer: 0,
      swingIsPerfect: false,
      stepPhase: 0,
      dustTimer: 0,
      aiTargetX: x,
      aiTargetY: y,
      aiReactTimer: 0,
      aiWindup: 0,
    };
  }

  private createBall(): BallEntity {
    return {
      x: 0,
      y: -WORLD.courtHalfH + 30,
      z: 36,
      vx: 0,
      vy: 0,
      vz: 0,
      spinX: 0,
      lastHitter: 'opponent',
      bouncesOnTargetSide: 0,
      firstBounceIn: false,
      isPerfectShot: false,
      inPlay: false,
      trail: [],
    };
  }

  private bindEvents(): void {
    window.addEventListener('resize', this.handleResize);
    window.addEventListener('keydown', this.handleKeyDown, { passive: false });
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('mousemove', this.handleMouseMove);
    this.canvas.addEventListener('mousedown', this.handleMouseDown);
    window.addEventListener('mouseup', this.handleMouseUp);
    this.canvas.addEventListener('contextmenu', this.handleContextMenu);
    window.addEventListener('blur', this.handleWindowBlur);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
  }

  public destroy(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    window.removeEventListener('resize', this.handleResize);
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('mousemove', this.handleMouseMove);
    this.canvas.removeEventListener('mousedown', this.handleMouseDown);
    window.removeEventListener('mouseup', this.handleMouseUp);
    this.canvas.removeEventListener('contextmenu', this.handleContextMenu);
    window.removeEventListener('blur', this.handleWindowBlur);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
  }

  public startLoop(): void {
    if (this.rafId !== null) return;
    this.lastTimestamp = performance.now();
    const tick = (now: number) => {
      const rawDt = (now - this.lastTimestamp) / 1000;
      this.lastTimestamp = now;
      const dt = Math.min(Math.max(rawDt, 0), 0.05);

      this.update(dt);
      this.render();

      if (this.hudDirty) {
        this.hudDirty = false;
        this.emitHud();
      }

      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private handleResize = (): void => {
    const parent = this.canvas.parentElement;
    const width = parent ? parent.clientWidth : window.innerWidth;
    const height = parent ? parent.clientHeight : window.innerHeight;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.viewWidth = Math.max(320, width);
    this.viewHeight = Math.max(320, height);

    this.canvas.width = Math.round(this.viewWidth * this.dpr);
    this.canvas.height = Math.round(this.viewHeight * this.dpr);
    this.canvas.style.width = `${this.viewWidth}px`;
    this.canvas.style.height = `${this.viewHeight}px`;

    // Fit entire court generously with breathing room
    const padX = 28;
    const padY = 24;
    const scaleX = (this.viewWidth - padX * 2) / (WORLD.doublesHalfW * 2 + 190);
    const scaleY = (this.viewHeight - padY * 2) / (WORLD.courtHalfH * 2 + 115);
    this.worldScale = Math.min(scaleX, scaleY);
    this.worldOffsetX = this.viewWidth * 0.5;
    this.worldOffsetY = this.viewHeight * 0.5 + 8;
  };

  private handleKeyDown = (e: KeyboardEvent): void => {
    const code = e.code;

    // Prevent scrolling with arrow keys or space
    if (
      code === 'ArrowUp' ||
      code === 'ArrowDown' ||
      code === 'ArrowLeft' ||
      code === 'ArrowRight' ||
      code === 'Space'
    ) {
      e.preventDefault();
    }

    tennisAudio.unlock();

    if (code === 'KeyM' && !e.repeat) {
      this.toggleMute();
      return;
    }

    if (this.state === 'TITLE_MENU') {
      if ((code === 'Enter' || code === 'Space') && !e.repeat) {
        this.startGame();
      }
      return;
    }

    if (this.state === 'PAUSED') {
      if ((code === 'Escape' || code === 'KeyP' || code === 'Enter' || code === 'Space') && !e.repeat) {
        this.resumeGame();
      }
      return;
    }

    if (this.state === 'GAME_OVER') {
      if ((code === 'Enter' || code === 'Space') && !e.repeat) {
        this.startGame();
      }
      return;
    }

    // PLAYING state
    if ((code === 'Escape' || code === 'KeyP') && !e.repeat) {
      this.pauseGame();
      return;
    }

    this.heldKeys.add(code);
  };

  private handleKeyUp = (e: KeyboardEvent): void => {
    this.heldKeys.delete(e.code);
  };

  private handleContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
  };

  private handleMouseMove = (e: MouseEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const wx = (cx - (this.worldOffsetX + this.cameraPanX)) / Math.max(0.001, this.worldScale);
    const wy = (cy - this.worldOffsetY) / Math.max(0.001, this.worldScale);

    this.mouseWorldX = wx;
    this.mouseWorldY = wy;
    this.hasMouseMoved = true;

    const now = performance.now();
    this.mouseSamples.push({ x: wx, y: wy, t: now });
    while (this.mouseSamples.length > 0 && now - this.mouseSamples[0].t > 130) {
      this.mouseSamples.shift();
    }

    if (this.mouseSamples.length >= 2) {
      const oldest = this.mouseSamples[0];
      const latest = this.mouseSamples[this.mouseSamples.length - 1];
      const totalDt = Math.max(0.012, (latest.t - oldest.t) / 1000);
      const vx = (latest.x - oldest.x) / totalDt;
      const vy = (latest.y - oldest.y) / totalDt;

      this.mouseVelX = this.mouseVelX * 0.35 + vx * 0.65;
      this.mouseVelY = this.mouseVelY * 0.35 + vy * 0.65;

      // Measure true acceleration (delta velocity across recent samples)
      let accelMag = 0;
      if (this.mouseSamples.length >= 3) {
        const midIdx = Math.floor(this.mouseSamples.length / 2);
        const mid = this.mouseSamples[midIdx];
        const dt1 = Math.max(0.008, (mid.t - oldest.t) / 1000);
        const dt2 = Math.max(0.008, (latest.t - mid.t) / 1000);
        const v1x = (mid.x - oldest.x) / dt1;
        const v1y = (mid.y - oldest.y) / dt1;
        const v2x = (latest.x - mid.x) / dt2;
        const v2y = (latest.y - mid.y) / dt2;
        accelMag = Math.hypot(v2x - v1x, v2y - v1y) / Math.max(0.016, (dt1 + dt2) * 0.5);
      }

      const speed = Math.hypot(this.mouseVelX, this.mouseVelY);
      const boost = Math.min(0.38, speed / 2600 + accelMag / 22000);
      if (boost >= this.peakAccelBoost * 0.85 || speed > 220) {
        this.peakAccelBoost = Math.max(this.peakAccelBoost, boost);
        this.peakFlickVx = this.mouseVelX;
        this.peakFlickVy = this.mouseVelY;
        this.peakFlickTimer = 0.18;
      }
    }
  };

  private handleMouseDown = (e: MouseEvent): void => {
    if (this.state !== 'PLAYING') return;
    if (e.target !== this.canvas) return;
    if (e.button !== 0 && e.button !== 2) return;

    e.preventDefault();
    tennisAudio.unlock();
    this.handleMouseMove(e);

    // Left click = Scharfer Schlag knapp übers Netz, Right click = Volley
    this.mouseButtonHeld = e.button === 2 ? 'volley' : 'sharp';
    this.mouseCharge = 0.08;
  };

  private handleMouseUp = (e: MouseEvent): void => {
    if (this.state !== 'PLAYING') {
      this.mouseButtonHeld = null;
      this.mouseCharge = 0;
      return;
    }
    if (!this.mouseButtonHeld) return;

    const releasedMatches =
      (e.button === 0 && this.mouseButtonHeld === 'sharp') ||
      (e.button === 2 && this.mouseButtonHeld === 'volley');
    if (!releasedMatches) return;

    const plan = this.computeMouseShotPlan(this.mouseButtonHeld, this.mouseCharge);
    this.pendingShot = {
      type: this.mouseButtonHeld,
      charge: this.mouseCharge,
      accelBoost: this.peakAccelBoost,
      targetX: plan.targetX,
      targetY: plan.targetY,
      flickVx: this.peakFlickVx,
    };
    this.mouseButtonHeld = null;
    this.mouseCharge = 0;
    this.mouseSwingReleased = true;
  };

  private handleWindowBlur = (): void => {
    this.heldKeys.clear();
    this.resetShotAim();
  };

  private handleVisibilityChange = (): void => {
    if (document.hidden) {
      this.heldKeys.clear();
      this.resetShotAim();
      if (this.state === 'PLAYING') {
        this.pauseGame();
      }
    }
  };

  // --- Public UI Control Methods ---

  public updateConfig(partial: Partial<GameConfig>): void {
    this.config = { ...this.config, ...partial };
    this.hudDirty = true;
  }

  public startGame(): void {
    tennisAudio.unlock();
    this.state = 'PLAYING';
    this.winner = null;
    this.lastCall = null;
    this.score = this.createInitialScore();
    this.stats = this.createInitialStats();
    this.scuffs = [];
    this.clearEffects();
    this.heldKeys.clear();
    this.resetShotAim();

    if (this.config.mode === 'machine') {
      this.setupMachineRound();
    } else {
      this.setupNextPoint(true);
    }
    this.hudDirty = true;
  }

  public pauseGame(): void {
    if (this.state !== 'PLAYING') return;
    this.state = 'PAUSED';
    this.heldKeys.clear();
    this.resetShotAim();
    this.hudDirty = true;
  }

  public resumeGame(): void {
    if (this.state !== 'PAUSED') return;
    this.state = 'PLAYING';
    this.lastTimestamp = performance.now();
    this.hudDirty = true;
  }

  public returnToTitle(): void {
    this.state = 'TITLE_MENU';
    this.winner = null;
    this.lastCall = null;
    this.heldKeys.clear();
    this.resetShotAim();
    this.initDemoRally();
    this.hudDirty = true;
  }

  public toggleMute(): void {
    tennisAudio.toggleMute();
    this.hudDirty = true;
  }

  private emitHud(): void {
    const playerServingPrompt =
      this.state === 'PLAYING' &&
      this.config.mode === 'match' &&
      this.phase === 'SERVE_WAIT' &&
      this.score.server === 'player';

    this.onHudUpdate({
      state: this.state,
      config: { ...this.config },
      phase: this.phase,
      score: { ...this.score },
      stats: { ...this.stats },
      winner: this.winner,
      lastCall: this.lastCall,
      playerServingPrompt,
      muted: tennisAudio.isMuted(),
    });
  }

  private clearEffects(): void {
    for (const p of this.particles) p.active = false;
    for (const c of this.callouts) c.active = false;
    this.hitstopTimer = 0;
    this.shakeTime = 0;
    this.netRipple = 0;
    this.courtFlash = 0;
  }

  // --- Setup Helpers ---

  private initDemoRally(): void {
    this.player = this.createAthlete(20, WORLD.courtHalfH - 18);
    this.opponent = this.createAthlete(-20, -WORLD.courtHalfH + 18);
    this.targetZone = null;
    this.phase = 'IN_PLAY';
    this.launchServeFromOpponent(true);
  }

  private setupMachineRound(): void {
    this.player = this.createAthlete(0, WORLD.courtHalfH - 16);
    this.ball = this.createBall();
    this.ball.inPlay = false;
    this.phase = 'SERVE_WAIT';
    this.phaseTimer = 0.55;
    this.machineCooldown = 0.55;
    this.machineCharge = 0;
    this.machineFiring = false;
    this.machinePointScoredForShot = false;
    this.spawnNewTargetZone();
  }

  private spawnNewTargetZone(): void {
    const sideSign = this.targetZone ? (this.targetZone.x >= 0 ? -1 : 1) : Math.random() < 0.5 ? -1 : 1;
    const x = sideSign * (75 + Math.random() * 95);
    const y = -(110 + Math.random() * 145);
    this.targetZone = {
      x,
      y,
      radius: 46,
      pulse: 0,
      points: 250,
      hitFlash: 0,
    };
  }

  private setupNextPoint(isFirstPoint = false): void {
    const isDeuceSide = (this.score.playerPoints + this.score.opponentPoints) % 2 === 0;
    const serveX = isDeuceSide ? 76 : -76;

    this.player = this.createAthlete(
      this.score.server === 'player' ? serveX : -serveX * 0.6,
      WORLD.courtHalfH - 8
    );
    this.opponent = this.createAthlete(
      this.score.server === 'opponent' ? -serveX : serveX * 0.6,
      -WORLD.courtHalfH + 8
    );

    this.ball = this.createBall();
    this.ball.inPlay = false;
    this.stats.rally = 0;
    this.phase = 'SERVE_WAIT';
    this.phaseTimer = isFirstPoint ? 0.55 : 0.85;
    this.hudDirty = true;
  }

  // --- Ballistic Physics Solver ---

  private launchBallToTarget(
    startX: number,
    startY: number,
    startZ: number,
    targetX: number,
    targetY: number,
    flightTime: number,
    minNetClearance: number,
    hitter: Side,
    isPerfect: boolean,
    spinX = 0
  ): number {
    let T = Math.max(0.42, flightTime);
    const g = WORLD.gravity;

    // Ensure clean arc over the net when requested
    const vyTentative = (targetY - startY) / T;
    if (vyTentative !== 0) {
      const tNet = (WORLD.netY - startY) / vyTentative;
      if (tNet > 0.05 && tNet < T - 0.05) {
        let vzTentative = (-startZ + 0.5 * g * T * T) / T;
        let zAtNet = startZ + vzTentative * tNet - 0.5 * g * tNet * tNet;
        let guard = 0;
        while (zAtNet < WORLD.netHeight + minNetClearance && guard < 12) {
          T += 0.055;
          const tNet2 = (WORLD.netY - startY) / ((targetY - startY) / T);
          vzTentative = (-startZ + 0.5 * g * T * T) / T;
          zAtNet = startZ + vzTentative * tNet2 - 0.5 * g * tNet2 * tNet2;
          guard++;
        }
      }
    }

    const vx = (targetX - startX) / T;
    const vy = (targetY - startY) / T;
    const vz = (-startZ + 0.5 * g * T * T) / T;

    this.ball.x = startX;
    this.ball.y = startY;
    this.ball.z = startZ;
    this.ball.vx = vx;
    this.ball.vy = vy;
    this.ball.vz = vz;
    this.ball.spinX = spinX;
    this.ball.lastHitter = hitter;
    this.ball.bouncesOnTargetSide = 0;
    this.ball.firstBounceIn = false;
    this.ball.isPerfectShot = isPerfect;
    this.ball.inPlay = true;
    this.ball.trail = [];

    // Convert world speed to plausible km/h display
    const speedWorld = Math.hypot(vx, vy);
    const kmh = Math.round(Math.min(218, Math.max(62, speedWorld * 0.215)));
    return kmh;
  }

  private launchServeFromOpponent(isDemo = false): void {
    const diff = DIFFICULTIES[this.config.difficulty];
    const startX = this.opponent.x + this.opponent.racketSide * 18;
    const startY = this.opponent.y + 18;
    const startZ = 66;

    // Aim cleanly into player's court so player always gets a fair, readable ball!
    const spread = isDemo ? 120 : 125 * diff.aiAngleSpread;
    const targetX = (Math.random() * 2 - 1) * spread;
    const targetY = 125 + Math.random() * 115;

    const flightTime = isDemo ? 0.92 : 1.05 / diff.aiShotSpeedScale;
    this.opponent.swingTimer = this.opponent.swingDuration;
    this.opponent.swingCooldown = 0.35;

    const kmh = this.launchBallToTarget(
      startX,
      startY,
      startZ,
      targetX,
      targetY,
      flightTime,
      20,
      'opponent',
      false,
      (Math.random() - 0.5) * 24
    );

    this.phase = 'IN_PLAY';
    if (!isDemo) {
      this.stats.lastSpeedKmh = kmh;
      tennisAudio.playRacketHit(0.82, false);
      this.spawnBurst(startX, startY - startZ * 0.85, '#f6f8d5', 7, 110);
      this.hudDirty = true;
    }
  }

  private launchServeFromPlayer(): void {
    const startX = this.player.x + 16;
    const startY = this.player.y - 16;
    const startZ = 68;

    const shot = this.pendingShot;
    const shotType = shot?.type ?? 'sharp';
    const charge = shot?.charge ?? 0.35;
    const accelBoost = shot?.accelBoost ?? 0;
    const totalPower = Math.min(1.25, charge + accelBoost);

    const plan = shot
      ? { targetX: shot.targetX, targetY: shot.targetY }
      : this.computeMouseShotPlan(shotType, charge);

    const isSharpServe = shotType === 'sharp';
    const targetX = plan.targetX;
    const targetY = Math.min(-145, Math.max(-WORLD.courtHalfH + 18, plan.targetY));
    const flightTime = isSharpServe
      ? Math.max(0.46, 0.76 - totalPower * 0.25)
      : Math.max(0.52, 0.80 - totalPower * 0.22);

    this.player.swingTimer = this.player.swingDuration;
    this.player.swingCooldown = 0.25;
    this.player.swingIsPerfect = totalPower > 0.55;

    const spinX = Math.max(-85, Math.min(85, (shot?.flickVx ?? 0) * 0.08));
    const kmh = this.launchBallToTarget(
      startX,
      startY,
      startZ,
      targetX,
      targetY,
      flightTime,
      isSharpServe ? Math.max(5.5, 11 - totalPower * 4) : 14,
      'player',
      totalPower > 0.55,
      spinX
    );

    const diff = DIFFICULTIES[this.config.difficulty];
    this.opponent.aiReactTimer = diff.aiSightDelay;
    this.pendingShot = null;
    this.mouseSwingReleased = false;

    this.phase = 'IN_PLAY';
    this.stats.rally = 1;
    this.stats.totalHits += 1;
    this.stats.lastSpeedKmh = kmh;
    this.stats.topSpeedKmh = Math.max(this.stats.topSpeedKmh, kmh);
    tennisAudio.playRacketHit(0.95 + totalPower * 0.25, totalPower > 0.55);
    this.triggerShake(0.08, 3.0 + totalPower * 2.6);
    this.spawnBurst(startX, startY - startZ * 0.85, '#e8f55f', 12, 160);
    this.spawnCallout(startX, startY - 40, 'AUFSCHLAG', `${kmh} km/h`, '#e8f55f');
    this.hudDirty = true;
  }

  private startMachineTelegraph(): void {
    const diff = DIFFICULTIES[this.config.difficulty];
    const ramp = Math.min(1, this.stats.rally / 18);
    const spread = 135 + ramp * 55;
    this.machineAimX = (Math.random() * 2 - 1) * Math.min(WORLD.courtHalfW - 30, spread);
    this.machineAimY = 120 + Math.random() * 145;

    const originX = 0;
    const originY = -WORLD.courtHalfH - 12;
    this.machineAngle = Math.atan2(this.machineAimY - originY, this.machineAimX - originX);
    this.machineFiring = true;
    this.machineCharge = 0;
    this.machineCooldown = Math.max(0.55, diff.machineInterval - ramp * 0.25);
  }

  private fireMachineBall(): void {
    const diff = DIFFICULTIES[this.config.difficulty];
    const ramp = Math.min(1, this.stats.rally / 20);
    const originX = Math.cos(this.machineAngle) * 22;
    const originY = -WORLD.courtHalfH - 12 + Math.sin(this.machineAngle) * 22;

    // Occasionally fire a fun high lob after rally >= 4
    const isLob = this.stats.rally >= 4 && Math.random() < 0.18;
    const flightTime = isLob
      ? 1.28
      : Math.max(0.68, (1.02 - ramp * 0.22) * (420 / diff.machineBaseSpeed));

    const kmh = this.launchBallToTarget(
      originX,
      originY,
      36,
      this.machineAimX,
      this.machineAimY,
      flightTime,
      isLob ? 75 : 18,
      'opponent',
      false,
      (Math.random() - 0.5) * (25 + ramp * 35)
    );

    this.phase = 'IN_PLAY';
    this.machineFiring = false;
    this.machineCharge = 0;
    this.machinePointScoredForShot = false;
    this.stats.lastSpeedKmh = kmh;
    tennisAudio.playMachineLaunch();
    this.spawnBurst(originX, originY - 26, '#e2e8f0', 10, 145);
    this.hudDirty = true;
  }

  // --- Input Helpers (WASD = Movement, Mouse = Aim/Acceleration + Left/Right Click Strikes) ---

  private getMoveX(): number {
    let x = 0;
    if (this.heldKeys.has('KeyA') || this.heldKeys.has('ArrowLeft')) x -= 1;
    if (this.heldKeys.has('KeyD') || this.heldKeys.has('ArrowRight')) x += 1;
    return x;
  }

  private getMoveY(): number {
    let y = 0;
    if (this.heldKeys.has('KeyW') || this.heldKeys.has('ArrowUp')) y -= 1;
    if (this.heldKeys.has('KeyS') || this.heldKeys.has('ArrowDown')) y += 1;
    return y;
  }

  private resetShotAim(): void {
    this.mouseButtonHeld = null;
    this.mouseCharge = 0;
    this.mouseSwingReleased = false;
    this.pendingShot = null;
    this.peakAccelBoost = 0;
    this.peakFlickVx = 0;
    this.peakFlickVy = 0;
    this.peakFlickTimer = 0;
    this.mouseSamples = [];
  }

  private updateShotAim(dt: number): void {
    // Charge power smoothly the longer Left or Right mouse button is held
    if (this.mouseButtonHeld) {
      const chargeTime = this.mouseButtonHeld === 'sharp' ? 0.58 : 0.52;
      this.mouseCharge = Math.min(1, this.mouseCharge + dt / chargeTime);
    }

    // Smoothly decay recent mouse flick/acceleration boost
    if (this.peakFlickTimer > 0) {
      this.peakFlickTimer = Math.max(0, this.peakFlickTimer - dt);
    } else {
      const decay = Math.exp(-10 * dt);
      this.peakAccelBoost *= decay;
      this.peakFlickVx *= decay;
      this.peakFlickVy *= decay;
      if (this.peakAccelBoost < 0.01) this.peakAccelBoost = 0;
    }

    // Decay live velocity if mouse paused
    const velDecay = Math.exp(-14 * dt);
    this.mouseVelX *= velDecay;
    this.mouseVelY *= velDecay;
  }

  private computeMouseShotPlan(
    shotType: 'sharp' | 'volley',
    charge: number
  ): {
    targetX: number;
    targetY: number;
    flightTime: number;
    clearance: number;
    totalPower: number;
    label: string;
  } {
    const totalPower = Math.min(1.25, charge + this.peakAccelBoost);

    // 1. Base target from mouse cursor position (or ray from player if cursor is on lower half)
    let baseTargetX = 0;
    let baseTargetY = -215;

    if (this.hasMouseMoved) {
      if (this.mouseWorldY < -12) {
        // Cursor directly on opponent's half
        baseTargetX = this.mouseWorldX;
        baseTargetY = this.mouseWorldY;
      } else {
        // Project direction from player toward mouse onto opponent's half
        const dx = this.mouseWorldX - this.player.x;
        const dy = Math.min(-35, this.mouseWorldY - this.player.y);
        const desiredY = shotType === 'volley' ? -(130 + totalPower * 105) : -(185 + totalPower * 95);
        const scale = (desiredY - this.player.y) / dy;
        baseTargetX = this.player.x + dx * scale;
        baseTargetY = desiredY;
      }
    }

    // 2. Blend in mouse movement / flick vector (e.g. fast move left-forward shifts target left & deeper!)
    const flickShiftX = Math.max(-115, Math.min(115, this.peakFlickVx * 0.11));
    const flickShiftY = Math.max(-80, Math.min(55, this.peakFlickVy * 0.08));

    const targetX = Math.max(
      -WORLD.courtHalfW + 12,
      Math.min(WORLD.courtHalfW - 12, baseTargetX + flickShiftX)
    );
    const minY = -WORLD.courtHalfH + 14;
    const maxY = shotType === 'volley' ? -46 : -78;
    const targetY = Math.max(minY, Math.min(maxY, baseTargetY + flickShiftY));

    // 3. Trajectory parameters by shot type & totalPower (hold duration + mouse acceleration)
    let flightTime: number;
    let clearance: number;
    let label: string;

    if (shotType === 'sharp') {
      // Linke Maustaste: Scharfer Schlag knapp übers Netz
      flightTime = Math.max(0.44, 0.80 - totalPower * 0.29);
      clearance = Math.max(4.5, 11.5 - totalPower * 5.2);
      label = totalPower >= 0.8 ? 'SCHARF MAX' : 'SCHARF';
    } else {
      // Rechte Maustaste: Volley
      flightTime = Math.max(0.45, 0.72 - totalPower * 0.22);
      clearance = Math.max(7.5, 14.5 - totalPower * 4.5);
      label = totalPower >= 0.8 ? 'VOLLEY MAX' : 'VOLLEY';
    }

    return { targetX, targetY, flightTime, clearance, totalPower, label };
  }

  // --- Main Update Loop ---

  private update(dt: number): void {
    // Always decay camera shake, particles, callouts, net ripple
    this.updateEffects(dt);

    if (this.state === 'PAUSED' || this.state === 'GAME_OVER') {
      this.mouseSwingReleased = false;
      return;
    }

    if (this.hitstopTimer > 0) {
      this.hitstopTimer = Math.max(0, this.hitstopTimer - dt);
      return;
    }

    if (this.state === 'TITLE_MENU') {
      this.updateDemo(dt);
      return;
    }

    // PLAYING
    if (this.config.mode === 'machine') {
      this.updateMachineMode(dt);
    } else {
      this.updateMatchMode(dt);
    }

    this.mouseSwingReleased = false;
  }

  private updateDemo(dt: number): void {
    this.updateAI(this.opponent, 'opponent', dt, true);
    this.updateAI(this.player, 'player', dt, true);

    if (this.ball.inPlay) {
      this.updateBallPhysics(dt, true);
    } else {
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0) {
        this.launchServeFromOpponent(true);
      }
    }
  }

  private updateMatchMode(dt: number): void {
    this.updatePlayerMovement(dt);
    this.updateShotAim(dt);

    if (this.phase === 'SERVE_WAIT') {
      if (this.score.server === 'player') {
        // Keep player behind baseline during serve prep
        this.player.y = Math.max(WORLD.courtHalfH - 10, this.player.y);
        this.player.x = Math.max(-WORLD.courtHalfW + 18, Math.min(WORLD.courtHalfW - 18, this.player.x));
        // Hover ball gently in player's hand
        this.ball.x = this.player.x + 14;
        this.ball.y = this.player.y - 12;
        this.ball.z = 26 + Math.abs(Math.sin(performance.now() * 0.006)) * 18;
        this.ball.inPlay = false;

        if (this.mouseSwingReleased) {
          this.launchServeFromPlayer();
        }
      } else {
        // Opponent prepares serve
        this.ball.x = this.opponent.x + 14;
        this.ball.y = this.opponent.y + 12;
        this.ball.z = 26 + Math.abs(Math.sin(performance.now() * 0.006)) * 16;
        this.phaseTimer -= dt;
        if (this.phaseTimer <= 0) {
          this.launchServeFromOpponent(false);
        }
      }
      return;
    }

    if (this.phase === 'POINT_OVER') {
      this.updateBallPhysics(dt, false, true);
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0) {
        if (this.winner) {
          this.state = 'GAME_OVER';
          tennisAudio.playMatchEnd(this.winner === 'player');
          if (this.winner === 'player') {
            this.spawnVictoryConfetti();
          }
          this.hudDirty = true;
        } else {
          this.setupNextPoint(false);
        }
      }
      return;
    }

    // IN_PLAY
    this.handlePlayerSwingInput(dt);
    this.updateAI(this.opponent, 'opponent', dt, false);
    this.updateBallPhysics(dt, false, false);
  }

  private updateMachineMode(dt: number): void {
    this.updatePlayerMovement(dt);
    this.updateShotAim(dt);

    if (this.targetZone) {
      this.targetZone.pulse += dt * 3.2;
      if (this.targetZone.hitFlash > 0) {
        this.targetZone.hitFlash = Math.max(0, this.targetZone.hitFlash - dt * 2.5);
      }
    }

    if (this.phase === 'POINT_OVER') {
      this.updateBallPhysics(dt, false, true);
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0) {
        if (this.stats.lives <= 0) {
          this.state = 'GAME_OVER';
          tennisAudio.playMatchEnd(false);
          this.hudDirty = true;
        } else {
          this.phase = 'SERVE_WAIT';
          this.machineCooldown = 0.55;
          this.machineFiring = false;
          this.machineCharge = 0;
          this.ball.inPlay = false;
          this.hudDirty = true;
        }
      }
      return;
    }

    // If waiting for machine to launch next ball
    if (!this.ball.inPlay || (this.ball.lastHitter === 'player' && this.machinePointScoredForShot)) {
      if (this.ball.inPlay) {
        // Let the returned ball roll out gently in background
        this.updateBallPhysics(dt, false, true);
      }
      if (!this.machineFiring) {
        this.machineCooldown -= dt;
        if (this.machineCooldown <= 0) {
          this.startMachineTelegraph();
        }
      } else {
        this.machineCharge += dt / 0.32;
        if (this.machineCharge >= 1) {
          this.fireMachineBall();
        }
      }
      this.handlePlayerSwingInput(dt);
      return;
    }

    this.handlePlayerSwingInput(dt);
    this.updateBallPhysics(dt, false, false);
  }

  private updatePlayerMovement(dt: number): void {
    const surface = SURFACES[this.config.surface];
    const inX = this.getMoveX();
    const inY = this.getMoveY();

    const maxSpeed = 345;
    const accel = 2250;

    let mag = Math.hypot(inX, inY);
    const nx = mag > 0 ? inX / mag : 0;
    const ny = mag > 0 ? inY / mag : 0;

    if (mag > 0) {
      this.player.vx += nx * accel * dt;
      this.player.vy += ny * accel * dt;
      const spd = Math.hypot(this.player.vx, this.player.vy);
      if (spd > maxSpeed) {
        this.player.vx = (this.player.vx / spd) * maxSpeed;
        this.player.vy = (this.player.vy / spd) * maxSpeed;
      }
      this.player.stepPhase += dt * (spd * 0.045);

      // Subtle court dust when changing direction sharply
      this.player.dustTimer -= dt;
      if (this.player.dustTimer <= 0 && spd > 180) {
        this.player.dustTimer = 0.14;
        this.spawnParticle(
          this.player.x + (Math.random() - 0.5) * 10,
          this.player.y + 10,
          -this.player.vx * 0.12 + (Math.random() - 0.5) * 20,
          -this.player.vy * 0.12 + (Math.random() - 0.5) * 20,
          3.2,
          0.32,
          surface.dustColor,
          0.9
        );
      }
    } else {
      const damping = Math.exp(-surface.playerDrag * dt);
      this.player.vx *= damping;
      this.player.vy *= damping;
      if (Math.hypot(this.player.vx, this.player.vy) < 4) {
        this.player.vx = 0;
        this.player.vy = 0;
      }
    }

    this.player.x += this.player.vx * dt;
    this.player.y += this.player.vy * dt;

    // Keep player inside playable stadium bounds & on player's side of the net
    const maxBoundX = WORLD.doublesHalfW + 52;
    const minBoundY = WORLD.netY + 26;
    const maxBoundY = WORLD.courtHalfH + 46;
    this.player.x = Math.max(-maxBoundX, Math.min(maxBoundX, this.player.x));
    this.player.y = Math.max(minBoundY, Math.min(maxBoundY, this.player.y));

    // Automatically align forehand / backhand side toward incoming ball
    if (this.ball.inPlay && this.player.swingTimer <= 0) {
      const dx = this.ball.x - this.player.x;
      if (Math.abs(dx) > 10) {
        this.player.racketSide = dx >= 0 ? 1 : -1;
      }
    }

    if (this.player.swingTimer > 0) {
      this.player.swingTimer = Math.max(0, this.player.swingTimer - dt);
    }
    if (this.player.swingCooldown > 0) {
      this.player.swingCooldown = Math.max(0, this.player.swingCooldown - dt);
    }
  }

  private handlePlayerSwingInput(dt: number): void {
    if (this.mouseSwingReleased) {
      this.player.swingBuffer = 0.16; // generous 160ms buffer on release
      if (this.player.swingCooldown <= 0) {
        this.player.swingTimer = this.player.swingDuration;
        this.player.swingCooldown = 0.22;
        this.player.swingIsPerfect = false;
      }
    }

    if (this.player.swingBuffer > 0) {
      this.player.swingBuffer = Math.max(0, this.player.swingBuffer - dt);
      if (this.tryPlayerHitBall()) {
        this.player.swingBuffer = 0;
        this.pendingShot = null;
      } else if (this.player.swingBuffer === 0) {
        this.pendingShot = null;
      }
    }
  }

  private tryPlayerHitBall(): boolean {
    if (!this.ball.inPlay) return false;
    if (this.ball.lastHitter === 'player') return false;
    if (this.ball.y < WORLD.netY + 6) return false;

    const shot = this.pendingShot;
    const shotType = shot?.type ?? 'sharp';
    const wantsVolley = shotType === 'volley';

    const dx = this.ball.x - this.player.x;
    const dy = this.ball.y - this.player.y;
    const dist = Math.hypot(dx, dy);

    const maxReach = wantsVolley ? 78 : 70;
    const maxHeight = wantsVolley ? 128 : 106;
    if (dist > maxReach || this.ball.z > maxHeight) {
      return false;
    }

    // Set racket side to the actual contact side
    this.player.racketSide = dx >= -4 ? 1 : -1;
    this.player.swingTimer = this.player.swingDuration;
    this.player.swingCooldown = 0.22;

    const charge = shot?.charge ?? 0.2;
    const accelBoost = shot?.accelBoost ?? 0;
    const plan = this.computeMouseShotPlan(shotType, charge);
    const totalPower = Math.min(1.25, charge + accelBoost);

    // Use the snapshotted target from release (or live plan)
    let targetX = shot ? shot.targetX : plan.targetX;
    let targetY = shot ? shot.targetY : plan.targetY;
    let flightTime =
      shotType === 'sharp'
        ? Math.max(0.44, 0.80 - totalPower * 0.29)
        : Math.max(0.45, 0.72 - totalPower * 0.22);
    let clearance =
      shotType === 'sharp'
        ? Math.max(4.5, 11.5 - totalPower * 5.2)
        : Math.max(7.5, 14.5 - totalPower * 4.5);

    // Evaluate shot quality
    const isAirVolley =
      this.ball.bouncesOnTargetSide === 0 &&
      (wantsVolley || this.player.y < WORLD.serviceLineDist + 35);
    const idealDist = Math.abs(dist - 32);
    const idealHeight = this.ball.z >= 14 && this.ball.z <= 66;

    let quality: ShotQuality = 'GUT';
    if (isAirVolley || (wantsVolley && dist < 66)) {
      quality = 'VOLLEY';
    } else if (totalPower >= 0.72 || (idealDist <= 18 && idealHeight && this.ball.bouncesOnTargetSide === 1)) {
      quality = 'PERFEKT';
    } else if (dist > 58 && totalPower < 0.3) {
      quality = 'KNAPP';
    }

    const isPerfect = quality === 'PERFEKT' || quality === 'VOLLEY' || totalPower >= 0.75;
    this.player.swingIsPerfect = isPerfect;

    if (quality === 'KNAPP') {
      flightTime += 0.1;
      targetY = Math.max(-185, targetY + 32);
      clearance = Math.max(clearance, 20);
    }

    const flickVx = shot?.flickVx ?? this.peakFlickVx;
    const spin = Math.max(-95, Math.min(95, flickVx * 0.095));
    const kmh = this.launchBallToTarget(
      this.ball.x,
      this.ball.y,
      Math.max(18, this.ball.z),
      targetX,
      targetY,
      flightTime,
      clearance,
      'player',
      isPerfect,
      spin
    );

    // Give AI realistic human sight reaction pause right when player strikes!
    const diff = DIFFICULTIES[this.config.difficulty];
    this.opponent.aiReactTimer = diff.aiSightDelay;

    const hasFlickBoost = accelBoost >= 0.14;
    const shotLabel =
      shotType === 'volley' || quality === 'VOLLEY'
        ? hasFlickBoost
          ? 'POWER-VOLLEY!'
          : 'VOLLEY!'
        : totalPower >= 0.82
          ? 'SCHARF-WINNER!'
          : hasFlickBoost
            ? 'TURBO-SCHLAG!'
            : isPerfect
              ? 'SCHARF!'
              : quality === 'KNAPP'
                ? 'KNAPP'
                : '';

    this.peakAccelBoost = 0;

    // Update stats
    this.stats.rally += 1;
    this.stats.bestRally = Math.max(this.stats.bestRally, this.stats.rally);
    this.stats.totalHits += 1;
    this.stats.lastSpeedKmh = kmh;
    this.stats.topSpeedKmh = Math.max(this.stats.topSpeedKmh, kmh);
    if (isPerfect) {
      this.stats.perfectHits += 1;
    }

    // Audio & Juice
    const impactX = this.ball.x;
    const impactY = this.ball.y - this.ball.z * 0.85;
    tennisAudio.playRacketHit(0.78 + totalPower * 0.42, isPerfect);

    if (isPerfect) {
      this.hitstopTimer = totalPower >= 0.75 ? 0.052 : 0.04;
      this.triggerShake(0.11, 3.6 + totalPower * 3.0);
      this.spawnBurst(
        impactX,
        impactY,
        shotType === 'volley' ? '#38bdf8' : '#e8f55f',
        16,
        215
      );
      if (shotLabel) {
        this.spawnCallout(
          this.player.x,
          this.player.y - 36,
          shotLabel,
          `${kmh} km/h`,
          shotType === 'volley' ? '#38bdf8' : '#e8f55f'
        );
      }
    } else {
      this.triggerShake(0.05, 2.0);
      this.spawnBurst(impactX, impactY, '#f8fafc', 8, 120);
      if (shotLabel) {
        this.spawnCallout(this.player.x, this.player.y - 34, shotLabel, `${kmh} km/h`, '#f1f5f9');
      }
    }

    this.hudDirty = true;
    return true;
  }

  // --- Opponent AI (and Demo Player AI) ---

  private updateAI(
    actor: AthleteEntity,
    side: Side,
    dt: number,
    isDemo: boolean
  ): void {
    const diff = DIFFICULTIES[this.config.difficulty];
    const isTop = side === 'opponent';
    const baseHomeY = isTop ? -WORLD.courtHalfH + 22 : WORLD.courtHalfH - 22;

    const ballComingToMe =
      this.ball.inPlay &&
      this.ball.lastHitter !== side &&
      (isTop ? this.ball.vy < 0 : this.ball.vy > 0);

    if (ballComingToMe) {
      actor.aiReactTimer -= dt;
      if (actor.aiReactTimer <= 0) {
        actor.aiReactTimer = isDemo ? 0.08 : diff.aiReactionDelay;
        const pred = this.predictBallLanding();
        if (pred) {
          // Aim slightly behind predicted bounce so AI hits cleanly on the rise/fall
          const offsetY = isTop ? -26 : 26;
          const jitter = isDemo ? 0 : (Math.random() - 0.5) * diff.aiErrorMargin;
          actor.aiTargetX = Math.max(
            -WORLD.doublesHalfW - 15,
            Math.min(WORLD.doublesHalfW + 15, pred.x + jitter)
          );
          const rawY = pred.y + offsetY;
          actor.aiTargetY = isTop
            ? Math.max(-WORLD.courtHalfH - 34, Math.min(-45, rawY))
            : Math.min(WORLD.courtHalfH + 34, Math.max(45, rawY));
        }
      }
    } else {
      // Recover gradually toward center baseline (leaves windows for wrong-footing!)
      actor.aiTargetX = 0;
      actor.aiTargetY = baseHomeY;
      actor.aiWindup = Math.max(0, actor.aiWindup - dt * 4);
    }

    const dx = actor.aiTargetX - actor.x;
    const dy = actor.aiTargetY - actor.y;
    const dist = Math.hypot(dx, dy);

    const maxSpd = isDemo
      ? 335
      : (ballComingToMe ? diff.aiMaxSpeed : diff.aiMaxSpeed * 0.72) + Math.min(20, this.stats.rally * 1.5);
    const accel = isDemo ? 2400 : diff.aiAccel;

    if (dist > 5) {
      const desiredSpeed = Math.min(maxSpd, dist * 6.5);
      const desiredVx = (dx / dist) * desiredSpeed;
      const desiredVy = (dy / dist) * desiredSpeed;
      const dvx = desiredVx - actor.vx;
      const dvy = desiredVy - actor.vy;
      const dvMag = Math.hypot(dvx, dvy);
      const maxDv = accel * dt;
      if (dvMag > maxDv) {
        actor.vx += (dvx / dvMag) * maxDv;
        actor.vy += (dvy / dvMag) * maxDv;
      } else {
        actor.vx = desiredVx;
        actor.vy = desiredVy;
      }
    } else {
      const brake = Math.exp(-12 * dt);
      actor.vx *= brake;
      actor.vy *= brake;
    }

    actor.x += actor.vx * dt;
    actor.y += actor.vy * dt;
    const currentSpd = Math.hypot(actor.vx, actor.vy);
    if (currentSpd > 8) {
      actor.stepPhase += dt * (currentSpd * 0.042);
    }

    if (actor.swingTimer > 0) actor.swingTimer = Math.max(0, actor.swingTimer - dt);
    if (actor.swingCooldown > 0) actor.swingCooldown = Math.max(0, actor.swingCooldown - dt);

    // Telegraph windup when ball approaches
    if (ballComingToMe) {
      const distBall = Math.hypot(this.ball.x - actor.x, this.ball.y - actor.y);
      if (distBall < 145) {
        actor.aiWindup = Math.min(1, actor.aiWindup + dt * 5.5);
      }
      if (Math.abs(this.ball.x - actor.x) > 8 && actor.swingTimer <= 0) {
        actor.racketSide = this.ball.x >= actor.x ? 1 : -1;
      }

      // Execute AI return (realistic reach so sharp corners beat the AI!)
      const onMyHalf = isTop ? this.ball.y < -12 : this.ball.y > 12;
      const aiReach = isDemo ? 62 : 52;
      const canHit =
        onMyHalf &&
        distBall < aiReach &&
        this.ball.z <= 84 &&
        actor.swingCooldown <= 0 &&
        (this.ball.bouncesOnTargetSide >= 1 || Math.abs(this.ball.y) < WORLD.serviceLineDist);

      if (canHit) {
        this.executeAiHit(actor, side, isDemo);
      }
    }
  }

  private executeAiHit(actor: AthleteEntity, side: Side, isDemo: boolean): void {
    const diff = DIFFICULTIES[this.config.difficulty];
    const isTop = side === 'opponent';
    actor.swingTimer = actor.swingDuration;
    actor.swingCooldown = 0.34;
    actor.aiWindup = 0;

    // Choose smart target on opponent's half
    const opponentActor = isTop ? this.player : this.opponent;
    const openSideSign = opponentActor.x >= 0 ? -1 : 1;
    const spread = isDemo ? 145 : (115 + Math.min(60, this.stats.rally * 4)) * diff.aiAngleSpread;
    const mix = Math.random() < 0.68 ? openSideSign : -openSideSign;
    const targetX = Math.max(
      -WORLD.courtHalfW + 26,
      Math.min(WORLD.courtHalfW - 26, mix * (55 + Math.random() * (spread - 40)))
    );
    const depth = 165 + Math.random() * 110;
    const targetY = isTop ? depth : -depth;

    const rallyRamp = Math.min(0.18, this.stats.rally * 0.014);
    const baseFlight = isDemo ? 0.88 : (0.98 - rallyRamp) / diff.aiShotSpeedScale;
    const isStrong = !isDemo && this.stats.rally >= 4 && Math.random() < 0.28;

    const kmh = this.launchBallToTarget(
      this.ball.x,
      this.ball.y,
      Math.max(20, this.ball.z),
      targetX,
      targetY,
      Math.max(0.64, baseFlight - (isStrong ? 0.08 : 0)),
      isStrong ? 14 : 20,
      side,
      isStrong,
      (Math.random() - 0.5) * 38
    );

    if (!isDemo) {
      this.stats.lastSpeedKmh = kmh;
      tennisAudio.playRacketHit(isStrong ? 0.98 : 0.78, false);
      this.spawnBurst(this.ball.x, this.ball.y - this.ball.z * 0.85, '#f8fafc', 7, 115);
      this.hudDirty = true;
    }
  }

  // --- Ball Physics & Scoring Rules ---

  private updateBallPhysics(dt: number, isDemo: boolean, passiveRollOnly = false): void {
    const b = this.ball;
    if (!b.inPlay) return;

    const prevY = b.y;

    // Trail recording
    b.trail.push({ x: b.x, y: b.y, z: b.z, alpha: 1 });
    if (b.trail.length > 14) {
      b.trail.shift();
    }
    for (const t of b.trail) {
      t.alpha = Math.max(0, t.alpha - dt * 5.2);
    }

    // Integrate motion
    b.vx += b.spinX * dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.vz -= WORLD.gravity * dt;
    b.z += b.vz * dt;

    // Net crossing check
    if (!passiveRollOnly && ((prevY > WORLD.netY && b.y <= WORLD.netY) || (prevY < WORLD.netY && b.y >= WORLD.netY))) {
      if (b.z < WORLD.netHeight) {
        this.netRipple = 1;
        this.netRippleX = Math.max(-WORLD.doublesHalfW, Math.min(WORLD.doublesHalfW, b.x));
        this.netRipplePhase = 0;

        if (!isDemo) {
          tennisAudio.playNetClip();
        }

        if (b.z > WORLD.netHeight * 0.74) {
          // Lucky net cord roller!
          b.vy *= 0.62;
          b.vx *= 0.7;
          b.vz = Math.max(b.vz, 120);
          if (!isDemo) {
            this.spawnCallout(b.x, -18, 'NETZROLLER!', '', '#fde68a');
          }
        } else {
          // Caught in the net
          b.vy = -b.vy * 0.22;
          b.vx *= 0.35;
          b.vz = 40;
          if (isDemo) {
            b.inPlay = false;
            this.phaseTimer = 0.6;
          } else {
            this.resolveFault(b.lastHitter, 'NETZ!');
          }
          return;
        }
      }
    }

    // Ground bounce
    if (b.z <= 0) {
      b.z = 0;
      const impactVel = Math.abs(b.vz);
      const surface = SURFACES[this.config.surface];

      if (impactVel > 45) {
        b.vz = impactVel * surface.bounceDamp;
        b.vx *= surface.speedDamp;
        b.vy *= surface.speedDamp;
        b.spinX *= 0.55;

        if (!isDemo) {
          tennisAudio.playBounce(this.config.surface, impactVel);
        }

        // Scuff mark & dust burst
        this.addScuff(b.x, b.y);
        const onLine = this.isBallTouchingLine(b.x, b.y);
        this.spawnBurst(
          b.x,
          b.y,
          onLine ? '#ffffff' : surface.dustColor,
          onLine ? 10 : 6,
          95
        );

        if (!passiveRollOnly) {
          this.evaluateBounceRules(isDemo);
        }
      } else {
        b.vz = 0;
        b.vx *= 0.92;
        b.vy *= 0.92;
        if (Math.hypot(b.vx, b.vy) < 12) {
          b.inPlay = false;
        }
      }
    }

    // Far out-of-bounds fence safety
    const fenceX = WORLD.doublesHalfW + 115;
    const fenceY = WORLD.courtHalfH + 105;
    if (Math.abs(b.x) > fenceX || Math.abs(b.y) > fenceY) {
      if (isDemo) {
        b.inPlay = false;
        this.phaseTimer = 0.55;
      } else if (!passiveRollOnly) {
        if (b.bouncesOnTargetSide === 0) {
          this.resolveFault(b.lastHitter, 'AUS!');
        } else {
          // Bounced in bounds first, then rolled past fence -> receiver missed it
          const receiver: Side = b.lastHitter === 'player' ? 'opponent' : 'player';
          this.resolvePointWon(b.lastHitter, receiver === 'player' ? 'VERPASST' : 'PUNKT!');
        }
      } else {
        b.inPlay = false;
      }
    }
  }

  private evaluateBounceRules(isDemo: boolean): void {
    const b = this.ball;
    const bouncedOnSide: Side = b.y >= 0 ? 'player' : 'opponent';
    const targetSide: Side = b.lastHitter === 'player' ? 'opponent' : 'player';

    // Bounced on own side before crossing net
    if (bouncedOnSide === b.lastHitter) {
      if (isDemo) {
        b.inPlay = false;
        this.phaseTimer = 0.6;
      } else {
        this.resolveFault(b.lastHitter, 'NETZ!');
      }
      return;
    }

    b.bouncesOnTargetSide += 1;

    if (b.bouncesOnTargetSide === 1) {
      const margin = WORLD.ballRadius * 0.9;
      const inX = Math.abs(b.x) <= WORLD.courtHalfW + margin;
      const inY = Math.abs(b.y) <= WORLD.courtHalfH + margin;
      const isIn = inX && inY;
      b.firstBounceIn = isIn;

      if (!isIn) {
        if (isDemo) {
          b.inPlay = false;
          this.phaseTimer = 0.6;
        } else {
          this.resolveFault(b.lastHitter, 'AUS!');
        }
        return;
      }

      // In Ballmaschine mode, a clean player return into opponent's court immediately scores!
      if (!isDemo && this.config.mode === 'machine' && b.lastHitter === 'player' && !this.machinePointScoredForShot) {
        this.machinePointScoredForShot = true;
        const basePts = b.isPerfectShot ? 150 : 100;
        let gained = basePts;

        if (this.targetZone) {
          const distTarget = Math.hypot(b.x - this.targetZone.x, b.y - this.targetZone.y);
          if (distTarget <= this.targetZone.radius + WORLD.ballRadius) {
            gained += this.targetZone.points;
            this.stats.targetsHit += 1;
            this.targetZone.hitFlash = 1;
            tennisAudio.playTargetHit();
            this.spawnBurst(this.targetZone.x, this.targetZone.y, '#e8f55f', 22, 220);
            this.spawnCallout(
              this.targetZone.x,
              this.targetZone.y - 16,
              'ZIELTREFFER!',
              `+${gained}`,
              '#e8f55f'
            );
            this.spawnNewTargetZone();
          } else {
            this.spawnCallout(b.x, b.y - 16, `+${gained}`, '', '#f8fafc');
          }
        }

        this.stats.machineScore += gained;
        if (this.stats.machineScore > this.stats.bestMachineScore) {
          this.stats.bestMachineScore = this.stats.machineScore;
          this.saveBestScore(this.stats.bestMachineScore);
        }
        this.hudDirty = true;
      }
      return;
    }

    // Second bounce on receiver's side
    if (b.bouncesOnTargetSide >= 2) {
      if (isDemo) {
        b.inPlay = false;
        this.phaseTimer = 0.55;
        return;
      }
      if (targetSide === 'player') {
        this.resolvePointWon('opponent', 'DOPPELT!');
      } else {
        const label = this.stats.rally === 1 && this.score.server === 'player' ? 'ASS!' : 'PUNKT!';
        this.resolvePointWon('player', label);
      }
    }
  }

  private resolveFault(faultSide: Side, call: string): void {
    const pointWinner: Side = faultSide === 'player' ? 'opponent' : 'player';
    this.resolvePointWon(pointWinner, call);
  }

  private resolvePointWon(pointWinner: Side, call: string): void {
    if (this.phase === 'POINT_OVER') return;
    this.phase = 'POINT_OVER';
    this.phaseTimer = 1.15;
    this.lastCall = call;

    const playerWonPoint = pointWinner === 'player';

    if (this.config.mode === 'machine') {
      if (!playerWonPoint) {
        this.stats.lives = Math.max(0, this.stats.lives - 1);
        this.stats.rally = 0;
        tennisAudio.playPointResult(false);
        this.triggerShake(0.14, 5);
        this.spawnCallout(
          this.ball.x,
          Math.max(-220, Math.min(220, this.ball.y - 20)),
          call,
          this.stats.lives > 0 ? `Noch ${this.stats.lives} Bälle` : 'Vorbei',
          '#fca5a5'
        );
      }
      this.hudDirty = true;
      return;
    }

    // Match scoring
    tennisAudio.playPointResult(playerWonPoint);
    this.spawnCallout(
      Math.max(-180, Math.min(180, this.ball.x)),
      Math.max(-210, Math.min(210, this.ball.y - 24)),
      call,
      playerWonPoint ? 'Punkt für dich' : 'Punkt Gegner',
      playerWonPoint ? '#e8f55f' : '#fca5a5'
    );

    if (playerWonPoint) {
      this.score.playerPoints += 1;
    } else {
      this.score.opponentPoints += 1;
    }

    // Check game win (min 4 points and lead by 2)
    const p = this.score.playerPoints;
    const o = this.score.opponentPoints;
    if ((p >= 4 || o >= 4) && Math.abs(p - o) >= 2) {
      if (p > o) {
        this.score.playerGames += 1;
        this.lastCall = 'SPIELGEWINN!';
      } else {
        this.score.opponentGames += 1;
        this.lastCall = 'SPIEL GEGNER';
      }
      this.score.playerPoints = 0;
      this.score.opponentPoints = 0;
      // Switch server after each game
      this.score.server = this.score.server === 'player' ? 'opponent' : 'player';
      this.phaseTimer = 1.45;

      // Check match win
      if (this.score.playerGames >= this.score.gamesToWin) {
        this.winner = 'player';
        this.lastCall = 'MATCHGEWINN!';
      } else if (this.score.opponentGames >= this.score.gamesToWin) {
        this.winner = 'opponent';
        this.lastCall = 'MATCH GEGNER';
      }
    }

    this.hudDirty = true;
  }

  private predictBallLanding(): { x: number; y: number; t: number } | null {
    const b = this.ball;
    if (!b.inPlay) return null;
    const g = WORLD.gravity;
    const disc = b.vz * b.vz + 2 * g * Math.max(0, b.z);
    if (disc < 0) return null;
    const t = (b.vz + Math.sqrt(disc)) / g;
    if (t <= 0 || t > 3.5) return null;
    const x = b.x + b.vx * t + 0.5 * b.spinX * t * t;
    const y = b.y + b.vy * t;
    return { x, y, t };
  }

  private isBallTouchingLine(x: number, y: number): boolean {
    const tol = 8;
    return (
      Math.abs(Math.abs(x) - WORLD.courtHalfW) < tol ||
      Math.abs(Math.abs(y) - WORLD.courtHalfH) < tol ||
      Math.abs(Math.abs(y) - WORLD.serviceLineDist) < tol ||
      (Math.abs(x) < tol && Math.abs(y) <= WORLD.serviceLineDist)
    );
  }

  // --- Visual Effects Pool ---

  private addScuff(x: number, y: number): void {
    this.scuffs.push({ x, y, alpha: 0.42, radius: 5 + Math.random() * 2.5 });
    if (this.scuffs.length > 28) {
      this.scuffs.shift();
    }
  }

  private triggerShake(duration: number, intensity: number): void {
    this.shakeTime = Math.max(this.shakeTime, duration);
    this.shakeIntensity = Math.max(this.shakeIntensity, intensity);
  }

  private spawnParticle(
    x: number,
    y: number,
    vx: number,
    vy: number,
    size: number,
    maxLife: number,
    color: string,
    drag = 0.91
  ): void {
    for (const p of this.particles) {
      if (!p.active) {
        p.active = true;
        p.x = x;
        p.y = y;
        p.vx = vx;
        p.vy = vy;
        p.size = size;
        p.alpha = 1;
        p.life = maxLife;
        p.maxLife = maxLife;
        p.color = color;
        p.drag = drag;
        return;
      }
    }
  }

  private spawnBurst(x: number, y: number, color: string, count: number, speed: number): void {
    for (let i = 0; i < count; i++) {
      const ang = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.4;
      const spd = speed * (0.45 + Math.random() * 0.65);
      this.spawnParticle(
        x,
        y,
        Math.cos(ang) * spd,
        Math.sin(ang) * spd,
        2.5 + Math.random() * 2.8,
        0.24 + Math.random() * 0.22,
        color,
        0.88
      );
    }
  }

  private spawnVictoryConfetti(): void {
    const colors = ['#e8f55f', '#ffffff', '#f59e0b', '#38bdf8'];
    for (let i = 0; i < 48; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd = 80 + Math.random() * 240;
      this.spawnParticle(
        (Math.random() - 0.5) * 260,
        (Math.random() - 0.5) * 220,
        Math.cos(angle) * spd,
        Math.sin(angle) * spd,
        4 + Math.random() * 4,
        1.1 + Math.random() * 0.9,
        colors[i % colors.length],
        0.95
      );
    }
  }

  private spawnCallout(
    x: number,
    y: number,
    text: string,
    subtext: string,
    color: string
  ): void {
    for (const c of this.callouts) {
      if (!c.active) {
        c.active = true;
        c.x = x;
        c.y = y;
        c.vy = -30;
        c.text = text;
        c.subtext = subtext;
        c.color = color;
        c.life = 0.95;
        c.maxLife = 0.95;
        c.scale = 1;
        return;
      }
    }
  }

  private updateEffects(dt: number): void {
    const targetPanX =
      this.state === 'TITLE_MENU' && this.viewWidth >= 960
        ? Math.min(185, (this.viewWidth - 440) * 0.22)
        : 0;
    this.cameraPanX += (targetPanX - this.cameraPanX) * Math.min(1, dt * 6.5);

    if (this.shakeTime > 0) {
      this.shakeTime = Math.max(0, this.shakeTime - dt);
      if (this.shakeTime === 0) this.shakeIntensity = 0;
    }

    if (this.netRipple > 0) {
      this.netRipple = Math.max(0, this.netRipple - dt * 2.4);
      this.netRipplePhase += dt * 42;
    }

    if (this.courtFlash > 0) {
      this.courtFlash = Math.max(0, this.courtFlash - dt * 4);
    }

    for (const p of this.particles) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const dragPow = Math.pow(p.drag, dt * 60);
      p.vx *= dragPow;
      p.vy *= dragPow;
      p.alpha = p.life / p.maxLife;
    }

    for (const c of this.callouts) {
      if (!c.active) continue;
      c.life -= dt;
      if (c.life <= 0) {
        c.active = false;
        continue;
      }
      c.y += c.vy * dt;
      c.vy *= 0.94;
    }

    for (let i = this.scuffs.length - 1; i >= 0; i--) {
      this.scuffs[i].alpha -= dt * 0.018;
      if (this.scuffs[i].alpha <= 0) {
        this.scuffs.splice(i, 1);
      }
    }
  }

  // --- Offscreen Court Surface Cache ---

  private getSurfaceCanvas(surfaceId: CourtSurface): HTMLCanvasElement {
    const cached = this.surfaceCanvasCache[surfaceId];
    if (cached) return cached;

    const surface = SURFACES[surfaceId];
    const cw = WORLD.width;
    const ch = WORLD.height;
    const off = document.createElement('canvas');
    off.width = cw;
    off.height = ch;
    const ctx = off.getContext('2d')!;

    ctx.save();
    ctx.translate(cw / 2, ch / 2);

    // Outer stadium apron
    ctx.fillStyle = surface.outerDark;
    ctx.fillRect(-cw / 2, -ch / 2, cw, ch);

    // Sunlit outer court surround
    const surroundW = WORLD.doublesHalfW + 122;
    const surroundH = WORLD.courtHalfH + 74;
    ctx.fillStyle = surface.outerColor;
    ctx.fillRect(-surroundW, -surroundH, surroundW * 2, surroundH * 2);

    // Subtle windscreens / fence border
    ctx.strokeStyle = surface.fenceColor;
    ctx.lineWidth = 10;
    ctx.strokeRect(-surroundW, -surroundH, surroundW * 2, surroundH * 2);

    // Inner playable court surface (doubles footprint)
    ctx.fillStyle = surface.innerColor;
    ctx.fillRect(
      -WORLD.doublesHalfW,
      -WORLD.courtHalfH,
      WORLD.doublesHalfW * 2,
      WORLD.courtHalfH * 2
    );

    // Subtle mowed stripes on grass or brushed lanes on clay/hard
    const stripeCount = surfaceId === 'grass' ? 14 : 8;
    const stripeH = (WORLD.courtHalfH * 2) / stripeCount;
    ctx.fillStyle = surface.innerStripe;
    for (let i = 0; i < stripeCount; i += 2) {
      ctx.fillRect(
        -WORLD.doublesHalfW,
        -WORLD.courtHalfH + i * stripeH,
        WORLD.doublesHalfW * 2,
        stripeH
      );
    }

    // Tactile micro-grain noise texture
    const dotCount = surfaceId === 'clay' ? 3200 : 1600;
    for (let i = 0; i < dotCount; i++) {
      const gx = (Math.random() - 0.5) * surroundW * 2;
      const gy = (Math.random() - 0.5) * surroundH * 2;
      ctx.fillStyle =
        Math.random() > 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.045)';
      ctx.fillRect(gx, gy, 2, 2);
    }

    // Subtle warm golden-hour diagonal sunlight gradient
    const sunGrad = ctx.createLinearGradient(-surroundW, -surroundH, surroundW, surroundH);
    sunGrad.addColorStop(0, 'rgba(255, 244, 214, 0.09)');
    sunGrad.addColorStop(0.55, 'rgba(255, 244, 214, 0)');
    sunGrad.addColorStop(1, 'rgba(10, 18, 14, 0.16)');
    ctx.fillStyle = sunGrad;
    ctx.fillRect(-surroundW, -surroundH, surroundW * 2, surroundH * 2);

    // Crisp ITF Court Lines
    ctx.strokeStyle = surface.lineColor;
    ctx.lineCap = 'square';
    ctx.lineWidth = 3.2;

    // Outer doubles rectangle
    ctx.strokeRect(
      -WORLD.doublesHalfW,
      -WORLD.courtHalfH,
      WORLD.doublesHalfW * 2,
      WORLD.courtHalfH * 2
    );

    // Singles sidelines (slightly brighter/emphasized since singles is playable bounds)
    ctx.beginPath();
    ctx.moveTo(-WORLD.courtHalfW, -WORLD.courtHalfH);
    ctx.lineTo(-WORLD.courtHalfW, WORLD.courtHalfH);
    ctx.moveTo(WORLD.courtHalfW, -WORLD.courtHalfH);
    ctx.lineTo(WORLD.courtHalfW, WORLD.courtHalfH);
    ctx.stroke();

    // Service lines
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(-WORLD.courtHalfW, -WORLD.serviceLineDist);
    ctx.lineTo(WORLD.courtHalfW, -WORLD.serviceLineDist);
    ctx.moveTo(-WORLD.courtHalfW, WORLD.serviceLineDist);
    ctx.lineTo(WORLD.courtHalfW, WORLD.serviceLineDist);
    // Center service line
    ctx.moveTo(0, -WORLD.serviceLineDist);
    ctx.lineTo(0, WORLD.serviceLineDist);
    // Center baseline hash marks
    ctx.moveTo(0, -WORLD.courtHalfH);
    ctx.lineTo(0, -WORLD.courtHalfH + 11);
    ctx.moveTo(0, WORLD.courtHalfH);
    ctx.lineTo(0, WORLD.courtHalfH - 11);
    ctx.stroke();

    // Umpire chair on the left sideline at net level
    this.drawUmpireChair(ctx, -WORLD.doublesHalfW - 44, -2);

    // Player benches on the right sideline
    this.drawBench(ctx, WORLD.doublesHalfW + 46, -86);
    this.drawBench(ctx, WORLD.doublesHalfW + 46, 86);

    ctx.restore();
    this.surfaceCanvasCache[surfaceId] = off;
    return off;
  }

  private drawUmpireChair(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    ctx.save();
    ctx.translate(x, y);
    // Soft sun shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.24)';
    ctx.fillRect(-10, -14, 34, 34);
    // Platform base
    ctx.fillStyle = '#25332b';
    ctx.fillRect(-14, -18, 28, 36);
    ctx.strokeStyle = '#d7dfd6';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(-14, -18, 28, 36);
    // Seat cushion
    ctx.fillStyle = '#e8e4d8';
    ctx.fillRect(-9, -11, 18, 22);
    // Sun canopy bar
    ctx.fillStyle = '#1b4332';
    ctx.fillRect(-13, -16, 8, 32);
    ctx.restore();
  }

  private drawBench(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(-6, -24, 24, 54);
    ctx.fillStyle = '#6f4e37';
    ctx.fillRect(-9, -27, 18, 54);
    ctx.strokeStyle = '#3d2a1d';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(-9, -27, 18, 54);
    // White folded towel
    ctx.fillStyle = '#f5f4ef';
    ctx.fillRect(-6, -12, 12, 16);
    ctx.restore();
  }

  // --- Main Render Loop ---

  private render(): void {
    const ctx = this.ctx;
    const surface = SURFACES[this.config.surface];

    ctx.save();
    ctx.scale(this.dpr, this.dpr);

    // Fill entire canvas edge-to-edge with stadium perimeter color
    ctx.fillStyle = surface.outerDark;
    ctx.fillRect(0, 0, this.viewWidth, this.viewHeight);

    // Apply decaying camera shake
    let shakeX = 0;
    let shakeY = 0;
    if (this.shakeTime > 0) {
      const mag = this.shakeIntensity * (this.shakeTime / 0.14);
      shakeX = (Math.random() - 0.5) * mag * 2;
      shakeY = (Math.random() - 0.5) * mag * 2;
    }

    ctx.translate(this.worldOffsetX + this.cameraPanX + shakeX, this.worldOffsetY + shakeY);
    ctx.scale(this.worldScale, this.worldScale);

    // 1. Cached textured court
    const courtImg = this.getSurfaceCanvas(this.config.surface);
    ctx.drawImage(courtImg, -WORLD.width / 2, -WORLD.height / 2);

    // 2. Fading court scuff marks
    for (const s of this.scuffs) {
      ctx.fillStyle =
        this.config.surface === 'clay'
          ? `rgba(82, 34, 18, ${s.alpha * 0.6})`
          : `rgba(255, 255, 255, ${s.alpha * 0.45})`;
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, s.radius, s.radius * 0.65, 0.3, 0, Math.PI * 2);
      ctx.fill();
    }

    // 3. Target Zone (Ballmaschine mode)
    if (this.state !== 'TITLE_MENU' && this.config.mode === 'machine' && this.targetZone) {
      this.drawTargetZone(ctx, this.targetZone);
    }

    // 4. Landing Ring Indicator (when ball is coming to player side)
    if (this.state === 'PLAYING' && this.ball.inPlay && this.ball.lastHitter === 'opponent' && this.ball.bouncesOnTargetSide === 0) {
      this.drawLandingIndicator(ctx);
    }

    // 4.5. Diegetic Mouse Aim Reticle & Charge/Acceleration Gauge
    if (this.state === 'PLAYING' && this.hasMouseMoved) {
      this.drawShotAimReticle(ctx);
    }

    // 5. Subtle reach readiness cue around player when ball is hittable
    if (this.state === 'PLAYING' && this.phase === 'IN_PLAY') {
      this.drawPlayerHitWindowCue(ctx);
    }

    // 6. Top side entity (Opponent or Ball Machine)
    if (this.state !== 'TITLE_MENU' && this.config.mode === 'machine') {
      this.drawBallMachine(ctx);
    } else {
      this.drawAthlete(ctx, this.opponent, 'opponent');
    }

    // 7. Ball behind net (if y < 0)
    if (this.ball.y < WORLD.netY) {
      this.drawBall(ctx);
    }

    // 8. 3D-layered Net with shadow & vibration
    this.drawNet(ctx);

    // 9. Ball in front of net (if y >= 0)
    if (this.ball.y >= WORLD.netY) {
      this.drawBall(ctx);
    }

    // 10. Player athlete
    this.drawAthlete(ctx, this.player, 'player');

    // 11. Particles
    for (const p of this.particles) {
      if (!p.active) continue;
      ctx.globalAlpha = Math.max(0, Math.min(1, p.alpha));
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // 12. Diegetic floating callouts
    for (const c of this.callouts) {
      if (!c.active) continue;
      const progress = 1 - c.life / c.maxLife;
      const alpha = progress < 0.7 ? 1 : 1 - (progress - 0.7) / 0.3;
      ctx.save();
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.textAlign = 'center';
      ctx.font = '800 22px "Barlow Condensed", sans-serif';
      ctx.fillStyle = 'rgba(12, 18, 15, 0.75)';
      ctx.fillText(c.text, c.x + 1.5, c.y + 1.5);
      ctx.fillStyle = c.color;
      ctx.fillText(c.text, c.x, c.y);

      if (c.subtext) {
        ctx.font = '600 12px "Plus Jakarta Sans", sans-serif';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
        ctx.fillText(c.subtext, c.x, c.y + 15);
      }
      ctx.restore();
    }

    ctx.restore();
  }

  private drawTargetZone(ctx: CanvasRenderingContext2D, zone: TargetZone): void {
    ctx.save();
    ctx.translate(zone.x, zone.y);

    const pulseScale = 1 + Math.sin(zone.pulse) * 0.05;
    const r = zone.radius * pulseScale;

    // Warm golden court circle
    ctx.fillStyle =
      zone.hitFlash > 0
        ? `rgba(232, 245, 95, ${0.42 * zone.hitFlash})`
        : 'rgba(232, 245, 95, 0.14)';
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#e8f55f';
    ctx.lineWidth = 2.4;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Inner bullseye ring
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.45, 0, Math.PI * 2);
    ctx.stroke();

    ctx.font = '700 13px "Barlow Condensed", sans-serif';
    ctx.fillStyle = '#f8fafc';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('+250', 0, 0);

    ctx.restore();
  }

  private drawLandingIndicator(ctx: CanvasRenderingContext2D): void {
    const pred = this.predictBallLanding();
    if (!pred || pred.y < 0) return;

    const clampedT = Math.max(0, Math.min(1, pred.t / 1.0));
    const outerR = 11 + clampedT * 22;

    ctx.save();
    ctx.translate(pred.x, pred.y);

    // Outer shrinking ring
    ctx.strokeStyle = `rgba(232, 245, 95, ${0.85 - clampedT * 0.4})`;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(0, 0, outerR, 0, Math.PI * 2);
    ctx.stroke();

    // Inner crisp cross mark
    ctx.fillStyle = 'rgba(232, 245, 95, 0.35)';
    ctx.beginPath();
    ctx.arc(0, 0, 5.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  private drawShotAimReticle(ctx: CanvasRenderingContext2D): void {
    const activeType = this.mouseButtonHeld ?? 'sharp';
    const isCharging = this.mouseButtonHeld !== null;
    const plan = this.computeMouseShotPlan(activeType, this.mouseCharge);
    const powerRatio = Math.min(1, plan.totalPower);

    const accent = !isCharging
      ? 'rgba(248, 250, 252, 0.75)'
      : activeType === 'volley'
        ? '#38bdf8'
        : powerRatio >= 0.8
          ? '#e8f55f'
          : '#f97316';

    ctx.save();

    // Subtle dashed aim guide line from player toward target landing point
    ctx.strokeStyle = !isCharging
      ? 'rgba(255, 255, 255, 0.14)'
      : activeType === 'volley'
        ? 'rgba(56, 189, 248, 0.34)'
        : 'rgba(249, 115, 22, 0.32)';
    ctx.lineWidth = isCharging ? 1.9 : 1.2;
    ctx.setLineDash([6, 8]);
    ctx.beginPath();
    ctx.moveTo(this.player.x, this.player.y - 16);
    ctx.lineTo(plan.targetX, plan.targetY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Target landing reticle on opponent's half
    const r = isCharging ? 20 - powerRatio * 7 : 14;
    ctx.save();
    ctx.translate(plan.targetX, plan.targetY);

    if (isCharging) {
      ctx.fillStyle =
        activeType === 'volley'
          ? 'rgba(56, 189, 248, 0.18)'
          : 'rgba(249, 115, 22, 0.18)';
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.strokeStyle = accent;
    ctx.lineWidth = isCharging ? 2.4 : 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();

    // Crosshair ticks
    ctx.beginPath();
    ctx.moveTo(-r - 4, 0);
    ctx.lineTo(-r + 3, 0);
    ctx.moveTo(r - 3, 0);
    ctx.lineTo(r + 4, 0);
    ctx.moveTo(0, -r - 4);
    ctx.lineTo(0, -r + 3);
    ctx.moveTo(0, r - 3);
    ctx.lineTo(0, r + 4);
    ctx.stroke();

    // Compact label under reticle while charging or brisk mouse flick
    if (isCharging || this.peakAccelBoost > 0.12) {
      const pct = Math.min(125, Math.round(plan.totalPower * 100));
      const text = isCharging ? `${plan.label} · ${pct}%` : `SCHWUNG +${Math.round(this.peakAccelBoost * 100)}%`;
      ctx.font = '700 12px "Barlow Condensed", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(12, 18, 15, 0.76)';
      ctx.fillText(text, 1, r + 15);
      ctx.fillStyle = isCharging ? accent : '#e8f55f';
      ctx.fillText(text, 0, r + 14);
    }
    ctx.restore();

    // Diegetic power charge gauge curved right below the player while holding Left or Right mouse button
    if (isCharging) {
      ctx.save();
      ctx.translate(this.player.x, this.player.y);
      const arcR = 30;
      const startA = Math.PI * 0.22;
      const endA = Math.PI * 0.78;
      const sweep = endA - startA;

      ctx.strokeStyle = 'rgba(15, 23, 18, 0.58)';
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(0, 0, arcR, startA, endA);
      ctx.stroke();

      ctx.strokeStyle = accent;
      ctx.lineWidth = 3.8;
      ctx.beginPath();
      ctx.arc(0, 0, arcR, startA, startA + sweep * powerRatio);
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();
  }

  private drawPlayerHitWindowCue(ctx: CanvasRenderingContext2D): void {
    if (!this.ball.inPlay || this.ball.lastHitter === 'player') return;
    if (this.ball.y < WORLD.netY + 6) return;

    const dist = Math.hypot(this.ball.x - this.player.x, this.ball.y - this.player.y);
    if (dist > 82 || this.ball.z > 106) return;

    const inSweetSpot = dist <= 56 && this.ball.z <= 70;
    ctx.save();
    ctx.translate(this.player.x, this.player.y);
    ctx.strokeStyle = inSweetSpot
      ? 'rgba(232, 245, 95, 0.72)'
      : 'rgba(255, 255, 255, 0.28)';
    ctx.lineWidth = inSweetSpot ? 2.4 : 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, 44, -Math.PI * 0.85, -Math.PI * 0.15);
    ctx.stroke();
    ctx.restore();
  }

  private drawBallMachine(ctx: CanvasRenderingContext2D): void {
    const mx = 0;
    const my = -WORLD.courtHalfH - 12;

    ctx.save();
    ctx.translate(mx, my);

    // Shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.beginPath();
    ctx.ellipse(4, 6, 26, 22, 0, 0, Math.PI * 2);
    ctx.fill();

    // Chassis base
    ctx.fillStyle = '#1f2937';
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(-22, -18, 44, 34, 7);
    ctx.fill();
    ctx.stroke();

    // Rotating cannon barrel
    ctx.save();
    ctx.rotate(this.machineAngle);
    ctx.fillStyle = '#334155';
    ctx.fillRect(6, -7, 22, 14);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(24, -5.5, 5, 11);

    // Subtle telegraph aim cone when charging
    if (this.machineFiring) {
      ctx.fillStyle = `rgba(232, 245, 95, ${0.14 + this.machineCharge * 0.28})`;
      ctx.beginPath();
      ctx.moveTo(28, -4);
      ctx.lineTo(74, -15);
      ctx.lineTo(74, 15);
      ctx.lineTo(28, 4);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    // Top ball hopper with visible yellow tennis balls
    ctx.fillStyle = '#111827';
    ctx.beginPath();
    ctx.arc(0, -2, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    const ballDots = [
      [-5, -5],
      [4, -6],
      [-4, 4],
      [5, 3],
      [0, -1],
    ];
    ctx.fillStyle = '#d8e84e';
    for (const [bx, by] of ballDots) {
      ctx.beginPath();
      ctx.arc(bx, by, 3.6, 0, Math.PI * 2);
      ctx.fill();
    }

    // Charge telegraph indicator light
    if (this.machineFiring) {
      ctx.fillStyle = this.machineCharge > 0.6 ? '#f59e0b' : '#e8f55f';
      ctx.beginPath();
      ctx.arc(0, 12, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  private drawNet(ctx: CanvasRenderingContext2D): void {
    const netHalfW = WORLD.doublesHalfW + 18;
    const rippleOffset =
      this.netRipple > 0 ? Math.sin(this.netRipplePhase) * this.netRipple * 8 : 0;

    ctx.save();

    // Ground shadow cast by net
    ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
    ctx.beginPath();
    ctx.moveTo(-netHalfW, WORLD.netY);
    ctx.lineTo(netHalfW, WORLD.netY);
    ctx.lineTo(netHalfW + 10, WORLD.netY + 18);
    ctx.lineTo(-netHalfW + 10, WORLD.netY + 18);
    ctx.closePath();
    ctx.fill();

    // Mesh body
    ctx.strokeStyle = 'rgba(20, 26, 22, 0.65)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(-netHalfW, WORLD.netY + 2);
    ctx.quadraticCurveTo(this.netRippleX, WORLD.netY + 2 + rippleOffset, netHalfW, WORLD.netY + 2);
    ctx.stroke();

    // Crosshatch mesh ticks
    ctx.strokeStyle = 'rgba(245, 245, 240, 0.28)';
    ctx.lineWidth = 1;
    for (let x = -netHalfW + 8; x < netHalfW; x += 12) {
      ctx.beginPath();
      ctx.moveTo(x, WORLD.netY - 2);
      ctx.lineTo(x, WORLD.netY + 5);
      ctx.stroke();
    }

    // Crisp white top net tape
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3.6;
    ctx.beginPath();
    ctx.moveTo(-netHalfW, WORLD.netY - 2);
    ctx.quadraticCurveTo(this.netRippleX, WORLD.netY - 2 + rippleOffset, netHalfW, WORLD.netY - 2);
    ctx.stroke();

    // Center net strap
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(-3, WORLD.netY - 4, 6, 8);

    // Net posts
    for (const px of [-netHalfW, netHalfW]) {
      ctx.fillStyle = '#1b2620';
      ctx.beginPath();
      ctx.arc(px, WORLD.netY, 6.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }

    ctx.restore();
  }

  private drawAthlete(ctx: CanvasRenderingContext2D, actor: AthleteEntity, side: Side): void {
    const isPlayer = side === 'player';
    const dirSign = isPlayer ? -1 : 1; // Player faces UP (-y), Opponent faces DOWN (+y)

    ctx.save();
    ctx.translate(actor.x, actor.y);

    // Swing progress 0 -> 1
    const swingProgress =
      actor.swingTimer > 0 ? 1 - actor.swingTimer / actor.swingDuration : 0;

    // Subtle windup / swing torso twist
    let bodyTwist = 0;
    if (swingProgress > 0) {
      // Smooth whip from back to follow-through
      const eased = 1 - Math.pow(1 - swingProgress, 3);
      bodyTwist = actor.racketSide * dirSign * (-0.75 + eased * 1.65);
    } else if (isPlayer && this.mouseButtonHeld) {
      // Live windup pullback as player holds Left/Right mouse button
      bodyTwist = actor.racketSide * dirSign * (-0.65 * Math.min(1, 0.25 + this.mouseCharge * 0.75));
    } else if (!isPlayer && actor.aiWindup > 0) {
      bodyTwist = actor.racketSide * dirSign * (-0.55 * actor.aiWindup);
    }

    // Ground contact shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
    ctx.beginPath();
    ctx.ellipse(5, 7, 19, 13, 0, 0, Math.PI * 2);
    ctx.fill();

    // Stepping shoes
    const stride = Math.sin(actor.stepPhase) * 6;
    const speed = Math.hypot(actor.vx, actor.vy);
    const stepAmt = Math.min(1, speed / 120);
    ctx.fillStyle = '#f8fafc';
    ctx.beginPath();
    ctx.ellipse(-7, stride * stepAmt, 4.5, 6.5, 0, 0, Math.PI * 2);
    ctx.ellipse(7, -stride * stepAmt, 4.5, 6.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Racket swing motion smear arc
    if (swingProgress > 0.05 && swingProgress < 0.85) {
      ctx.save();
      const arcAlpha = (1 - swingProgress) * (actor.swingIsPerfect ? 0.65 : 0.38);
      ctx.strokeStyle = actor.swingIsPerfect
        ? `rgba(232, 245, 95, ${arcAlpha})`
        : `rgba(255, 255, 255, ${arcAlpha})`;
      ctx.lineWidth = actor.swingIsPerfect ? 9 : 6;
      ctx.lineCap = 'round';
      const baseAng = isPlayer ? -Math.PI / 2 : Math.PI / 2;
      const startA = baseAng + actor.racketSide * 1.15;
      const endA = baseAng - actor.racketSide * 0.95;
      ctx.beginPath();
      ctx.arc(0, 0, 34, Math.min(startA, endA), Math.max(startA, endA));
      ctx.stroke();
      ctx.restore();
    }

    // Rotate upper body + racket
    ctx.rotate(bodyTwist);

    // Racket arm & racket
    const rSide = actor.racketSide;
    const armX = rSide * 15;
    const armY = dirSign * 6;
    const racketAngle =
      (isPlayer ? -Math.PI * 0.35 : Math.PI * 0.35) * rSide +
      (swingProgress > 0 ? -rSide * dirSign * swingProgress * 1.2 : 0);

    ctx.save();
    ctx.translate(armX, armY);
    ctx.rotate(racketAngle);

    // Forearm
    ctx.strokeStyle = '#e7b999';
    ctx.lineWidth = 4.6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(rSide * 10, dirSign * 7);
    ctx.stroke();

    // Racket handle
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 3.2;
    ctx.beginPath();
    ctx.moveTo(rSide * 9, dirSign * 6);
    ctx.lineTo(rSide * 17, dirSign * 13);
    ctx.stroke();

    // Racket oval head
    ctx.save();
    ctx.translate(rSide * 25, dirSign * 20);
    ctx.rotate(rSide * dirSign * 0.6);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.strokeStyle = isPlayer ? '#d93829' : '#f59e0b';
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.ellipse(0, 0, 10.5, 7.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Strings
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(-7, 0);
    ctx.lineTo(7, 0);
    ctx.moveTo(0, -5);
    ctx.lineTo(0, 5);
    ctx.stroke();
    ctx.restore();

    ctx.restore();

    // Athletic shoulders / shirt
    ctx.fillStyle = isPlayer ? '#f6f4ee' : '#1e293b';
    ctx.strokeStyle = isPlayer ? '#1b2b38' : '#e2e8f0';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, 0, 16, 10.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Shoulder accent stripe
    ctx.fillStyle = isPlayer ? '#c9382b' : '#f59e0b';
    ctx.fillRect(-12, -2, 24, 4);

    // Head
    ctx.fillStyle = '#e7b999';
    ctx.beginPath();
    ctx.arc(0, dirSign * 1.5, 8.2, 0, Math.PI * 2);
    ctx.fill();

    // Cap / Visor (distinct silhouette from top-down!)
    ctx.fillStyle = isPlayer ? '#1b3556' : '#f59e0b';
    ctx.beginPath();
    ctx.arc(0, dirSign * 0.5, 8.3, 0, Math.PI * 2);
    ctx.fill();

    // Cap brim facing the net
    ctx.fillStyle = isPlayer ? '#142842' : '#d97706';
    ctx.beginPath();
    ctx.ellipse(0, dirSign * 7.8, 6.2, 3.2, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  private drawBall(ctx: CanvasRenderingContext2D): void {
    const b = this.ball;
    if (!b.inPlay && this.phase !== 'SERVE_WAIT') return;

    const liftY = b.y - b.z * 0.85;
    const scale = 1 + Math.min(0.65, b.z * 0.0042);

    // 1. Dynamic sun shadow on the court plane
    const shadowX = b.x + b.z * 0.28 + 3;
    const shadowY = b.y + b.z * 0.18 + 3;
    const shadowAlpha = Math.max(0.1, 0.38 - b.z * 0.0018);
    const shadowR = WORLD.ballRadius * Math.max(0.6, 1.08 - b.z * 0.0022);

    ctx.fillStyle = `rgba(0, 0, 0, ${shadowAlpha})`;
    ctx.beginPath();
    ctx.ellipse(shadowX, shadowY, shadowR * 1.15, shadowR * 0.85, 0, 0, Math.PI * 2);
    ctx.fill();

    // 2. Speed ribbon trail
    if (b.inPlay && b.trail.length > 2) {
      for (let i = 1; i < b.trail.length; i++) {
        const prev = b.trail[i - 1];
        const curr = b.trail[i];
        const ratio = i / b.trail.length;
        ctx.strokeStyle = b.isPerfectShot
          ? `rgba(232, 245, 95, ${ratio * 0.58})`
          : `rgba(255, 255, 255, ${ratio * 0.34})`;
        ctx.lineWidth = WORLD.ballRadius * 1.45 * ratio;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y - prev.z * 0.85);
        ctx.lineTo(curr.x, curr.y - curr.z * 0.85);
        ctx.stroke();
      }
    }

    // 3. Tennis ball body
    const r = WORLD.ballRadius * scale;
    ctx.save();
    ctx.translate(b.x, liftY);

    ctx.fillStyle = '#d9ee45';
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();

    // Subtle spherical shading
    const grad = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
    grad.addColorStop(0, 'rgba(255, 255, 255, 0.55)');
    grad.addColorStop(0.7, 'rgba(217, 238, 69, 0)');
    grad.addColorStop(1, 'rgba(92, 114, 14, 0.45)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();

    // Classic white tennis seam
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.arc(-r * 0.48, 0, r * 0.65, -0.8, 0.8);
    ctx.stroke();

    // Crisp outline for high contrast on all surfaces
    ctx.strokeStyle = 'rgba(26, 36, 18, 0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
  }
}
