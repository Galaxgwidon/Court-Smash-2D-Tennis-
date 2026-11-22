import type { HudSnapshot } from '../game/types';

interface ModalOverlayProps {
  hud: HudSnapshot;
  onResume: () => void;
  onRestart: () => void;
  onMainMenu: () => void;
}

export function ModalOverlay({
  hud,
  onResume,
  onRestart,
  onMainMenu,
}: ModalOverlayProps) {
  const isPaused = hud.state === 'PAUSED';
  const isMatch = hud.config.mode === 'match';
  const playerWon = hud.winner === 'player';

  const heading = isPaused
    ? 'Pausiert'
    : isMatch
      ? playerWon
        ? 'Matchgewinn'
        : 'Match verloren'
      : 'Training beendet';

  const subtitle = isPaused
    ? 'Kurze Verschnaufpause an der Grundlinie.'
    : isMatch
      ? `Endstand ${hud.score.playerGames} : ${hud.score.opponentGames} nach Spielen`
      : `${hud.stats.machineScore} Punkte · Rekord ${hud.stats.bestMachineScore}`;

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-[#0d1410]/80 p-5">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-heading"
        className="w-full max-w-[420px] rounded-xl bg-[#15201a] border border-white/15 p-6 sm:p-7 flex flex-col gap-6"
      >
        <div className="flex flex-col gap-1">
          <h2
            id="modal-heading"
            className="font-display font-extrabold text-4xl tracking-wide text-[#f8f6f0]"
          >
            {heading}
          </h2>
          <p className="text-sm text-[#aebbb2] tabular-nums">{subtitle}</p>
        </div>

        {/* Match / Session Statistics */}
        <div className="grid grid-cols-3 gap-3 py-4 border-y border-white/10">
          <div>
            <div className="text-xs text-[#95a49a]">Beste Serie</div>
            <div className="font-display font-bold text-2xl text-[#f8f6f0] tabular-nums mt-0.5">
              {hud.stats.bestRally}
            </div>
          </div>
          <div>
            <div className="text-xs text-[#95a49a]">Perfekt</div>
            <div className="font-display font-bold text-2xl text-[#d9ee45] tabular-nums mt-0.5">
              {hud.stats.perfectHits}
            </div>
          </div>
          <div>
            <div className="text-xs text-[#95a49a]">Top-Speed</div>
            <div className="font-display font-bold text-2xl text-[#f8f6f0] tabular-nums mt-0.5">
              {hud.stats.topSpeedKmh > 0 ? `${hud.stats.topSpeedKmh}` : '—'}
              {hud.stats.topSpeedKmh > 0 && (
                <span className="text-xs font-sans font-normal text-[#95a49a] ml-1">km/h</span>
              )}
            </div>
          </div>
        </div>

        {isPaused && (
          <div className="text-xs text-[#b5c2b9] leading-relaxed">
            WASD: Bewegen · Maus bewegen: Schlagrichtung &amp; Beschleunigung · Linke Maustaste: scharfer Schlag knapp übers Netz · Rechte Maustaste: Volley (länger halten = schärfer).
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-col gap-2.5">
          {isPaused ? (
            <button
              type="button"
              onClick={onResume}
              className="w-full py-3 px-5 rounded-lg bg-[#d9ee45] hover:bg-[#e5f665] text-[#131d16] font-display font-extrabold text-xl tracking-wide transition-colors cursor-pointer whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              Weiterspielen
            </button>
          ) : (
            <button
              type="button"
              onClick={onRestart}
              className="w-full py-3 px-5 rounded-lg bg-[#d9ee45] hover:bg-[#e5f665] text-[#131d16] font-display font-extrabold text-xl tracking-wide transition-colors cursor-pointer whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              Nochmal spielen
            </button>
          )}

          <div className="grid grid-cols-2 gap-2.5">
            {isPaused && (
              <button
                type="button"
                onClick={onRestart}
                className="py-2.5 px-4 rounded-lg bg-[#203027] hover:bg-[#2a3e33] text-[#f5f3ec] text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d9ee45]"
              >
                Neu starten
              </button>
            )}
            <button
              type="button"
              onClick={onMainMenu}
              className={`py-2.5 px-4 rounded-lg bg-[#203027] hover:bg-[#2a3e33] text-[#f5f3ec] text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d9ee45] ${
                isPaused ? '' : 'col-span-2'
              }`}
            >
              Hauptmenü
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
