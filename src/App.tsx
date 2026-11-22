/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { GameHud } from './components/GameHud';
import { ModalOverlay } from './components/ModalOverlay';
import { TitleOverlay } from './components/TitleOverlay';
import { TennisEngine } from './game/engine';
import type { GameConfig, HudSnapshot } from './game/types';

const INITIAL_HUD: HudSnapshot = {
  state: 'TITLE_MENU',
  config: {
    mode: 'match',
    surface: 'clay',
    difficulty: 'club',
  },
  phase: 'IN_PLAY',
  score: {
    playerPoints: 0,
    opponentPoints: 0,
    playerGames: 0,
    opponentGames: 0,
    gamesToWin: 3,
    server: 'opponent',
  },
  stats: {
    rally: 0,
    bestRally: 0,
    perfectHits: 0,
    totalHits: 0,
    topSpeedKmh: 0,
    lastSpeedKmh: 0,
    machineScore: 0,
    bestMachineScore: 0,
    targetsHit: 0,
    lives: 3,
    maxLives: 3,
  },
  winner: null,
  lastCall: null,
  playerServingPrompt: false,
  muted: false,
};

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<TennisEngine | null>(null);
  const [hud, setHud] = useState<HudSnapshot>(INITIAL_HUD);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = new TennisEngine(canvas, (snapshot) => {
      setHud(snapshot);
    });
    engineRef.current = engine;
    engine.startLoop();

    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  const handleConfigChange = useCallback((partial: Partial<GameConfig>) => {
    engineRef.current?.updateConfig(partial);
  }, []);

  const handleStart = useCallback(() => {
    engineRef.current?.startGame();
  }, []);

  const handlePause = useCallback(() => {
    engineRef.current?.pauseGame();
  }, []);

  const handleResume = useCallback(() => {
    engineRef.current?.resumeGame();
  }, []);

  const handleMainMenu = useCallback(() => {
    engineRef.current?.returnToTitle();
  }, []);

  const handleToggleMute = useCallback(() => {
    engineRef.current?.toggleMute();
  }, []);

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-[#18211b]">
      {/* Isolated Canvas Host so React state updates never disturb the 60fps loop */}
      <div className="absolute inset-0 w-full h-full">
        <canvas
          ref={canvasRef}
          className={`block w-full h-full ${hud.state === 'PLAYING' ? 'cursor-crosshair' : 'cursor-default'}`}
          aria-label="2D Top-Down Tennis Spielfeld"
        />
      </div>

      {hud.state === 'TITLE_MENU' && (
        <TitleOverlay
          config={hud.config}
          bestMachineScore={hud.stats.bestMachineScore}
          onConfigChange={handleConfigChange}
          onStart={handleStart}
        />
      )}

      {hud.state !== 'TITLE_MENU' && (
        <GameHud
          hud={hud}
          onToggleMute={handleToggleMute}
          onPause={handlePause}
        />
      )}

      {(hud.state === 'PAUSED' || hud.state === 'GAME_OVER') && (
        <ModalOverlay
          hud={hud}
          onResume={handleResume}
          onRestart={handleStart}
          onMainMenu={handleMainMenu}
        />
      )}
    </main>
  );
}
