import { Pause, Volume2, VolumeX } from 'lucide-react';
import { formatPointLabels } from '../game/constants';
import type { HudSnapshot } from '../game/types';

interface GameHudProps {
  hud: HudSnapshot;
  onToggleMute: () => void;
  onPause: () => void;
}

function ServeBallIcon({ active }: { active: boolean }) {
  return (
    <svg
      viewBox="0 0 14 14"
      className="w-3 h-3 shrink-0"
      aria-hidden="true"
    >
      <circle
        cx="7"
        cy="7"
        r="5.5"
        fill={active ? '#d9ee45' : 'transparent'}
        stroke={active ? '#162018' : 'rgba(255,255,255,0.2)'}
        strokeWidth="1.2"
      />
    </svg>
  );
}

export function GameHud({ hud, onToggleMute, onPause }: GameHudProps) {
  const { config, score, stats, playerServingPrompt, muted } = hud;
  const pointLabels = formatPointLabels(score);

  return (
    <div className="fixed inset-0 z-10 pointer-events-none select-none">
      {/* Top Perimeter Bar */}
      <div className="flex items-start justify-between p-4 sm:p-5">
        {/* Top-Left Championship Broadcast Scoreboard (solid opaque, zero backdrop-filter) */}
        <div className="flex flex-col gap-1.5">
          {config.mode === 'match' ? (
            <div className="bg-[#131d17] border border-white/15 rounded-md overflow-hidden min-w-[208px]">
              <div className="grid grid-cols-[1fr_42px_48px] items-center px-3 py-1.5 text-[11px] font-medium text-[#95a49a] border-b border-white/10">
                <span>Match (bis {score.gamesToWin})</span>
                <span className="text-center">Satz</span>
                <span className="text-center">Pkt</span>
              </div>

              {/* Player Row */}
              <div className="grid grid-cols-[1fr_42px_48px] items-center px-3 py-1.5 border-b border-white/10">
                <div className="flex items-center gap-2 min-w-0">
                  <ServeBallIcon active={score.server === 'player'} />
                  <span className="text-sm font-semibold text-[#f8f6f0] truncate">Du</span>
                </div>
                <span className="font-display font-bold text-xl text-center text-[#f8f6f0] tabular-nums">
                  {score.playerGames}
                </span>
                <span className="font-display font-bold text-xl text-center text-[#d9ee45] tabular-nums bg-[#1c2b22] rounded-xs py-0.5">
                  {pointLabels.player}
                </span>
              </div>

              {/* Opponent Row */}
              <div className="grid grid-cols-[1fr_42px_48px] items-center px-3 py-1.5">
                <div className="flex items-center gap-2 min-w-0">
                  <ServeBallIcon active={score.server === 'opponent'} />
                  <span className="text-sm font-medium text-[#c5cfc8] truncate">Gegner</span>
                </div>
                <span className="font-display font-bold text-xl text-center text-[#c5cfc8] tabular-nums">
                  {score.opponentGames}
                </span>
                <span className="font-display font-bold text-xl text-center text-[#e2e8e4] tabular-nums bg-[#1a251e] rounded-xs py-0.5">
                  {pointLabels.opponent}
                </span>
              </div>
            </div>
          ) : (
            <div className="bg-[#131d17] border border-white/15 rounded-md px-3.5 py-2.5 flex items-center gap-5">
              <div>
                <div className="text-[11px] text-[#95a49a]">Punkte</div>
                <div className="font-display font-extrabold text-2xl leading-none text-[#d9ee45] tabular-nums mt-0.5">
                  {stats.machineScore}
                </div>
              </div>
              <div className="w-px h-7 bg-white/10" aria-hidden="true" />
              <div>
                <div className="text-[11px] text-[#95a49a]">Serie</div>
                <div className="font-display font-bold text-2xl leading-none text-[#f8f6f0] tabular-nums mt-0.5">
                  {stats.rally}
                </div>
              </div>
              <div className="w-px h-7 bg-white/10" aria-hidden="true" />
              <div>
                <div className="text-[11px] text-[#95a49a]">Bälle {stats.lives}/{stats.maxLives}</div>
                <div className="flex items-center gap-1.5 mt-1.5" aria-label={`${stats.lives} von ${stats.maxLives} Bällen übrig`}>
                  {Array.from({ length: stats.maxLives }).map((_, idx) => (
                    <ServeBallIcon key={idx} active={idx < stats.lives} />
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Unboxed quiet live metadata line */}
          <div className="flex items-center gap-2 text-xs font-medium text-[#e9eee9] px-1 tabular-nums drop-shadow-xs">
            {pointLabels.status && config.mode === 'match' && (
              <>
                <span className="text-[#d9ee45] font-semibold">{pointLabels.status}</span>
                <span aria-hidden="true">·</span>
              </>
            )}
            <span>Ballwechsel {stats.rally}</span>
            {stats.lastSpeedKmh > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span>{stats.lastSpeedKmh} km/h</span>
              </>
            )}
          </div>
        </div>

        {/* Top-Right Compact Utility Controls */}
        <div className="flex items-center gap-2 pointer-events-auto">
          <button
            type="button"
            onClick={(e) => {
              e.currentTarget.blur();
              onToggleMute();
            }}
            aria-label={muted ? 'Ton einschalten' : 'Ton stummschalten'}
            title={muted ? 'Ton einschalten (M)' : 'Ton stummschalten (M)'}
            className="w-10 h-10 rounded-md bg-[#131d17] border border-white/15 hover:bg-[#1e2d24] text-[#f5f3ec] flex items-center justify-center transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d9ee45]"
          >
            {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.currentTarget.blur();
              onPause();
            }}
            aria-label="Spiel pausieren"
            title="Pausieren (Esc)"
            className="w-10 h-10 rounded-md bg-[#131d17] border border-white/15 hover:bg-[#1e2d24] text-[#f5f3ec] flex items-center justify-center transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d9ee45]"
          >
            <Pause className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Quiet unobtrusive perimeter control legend */}
      <div className="fixed bottom-4 left-4 hidden sm:block text-[11px] font-medium text-[#e9eee9]/75 drop-shadow-xs">
        WASD Bewegen · Maus Zielen &amp; Schwung · Linksklick Scharf · Rechtsklick Volley (halten = schärfer)
      </div>

      {/* Contextual Bottom Prompt only when waiting for Player Serve */}
      {playerServingPrompt && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-[#131d17] border border-[#d9ee45]/40 rounded-md px-4 py-2 text-xs sm:text-sm font-medium text-[#f8f6f0] whitespace-nowrap">
          Dein Aufschlag · mit der <span className="text-[#d9ee45] font-semibold">Maus</span> zielen · <span className="text-[#d9ee45] font-semibold">Links-/Rechtsklick</span> halten &amp; loslassen
        </div>
      )}
    </div>
  );
}
