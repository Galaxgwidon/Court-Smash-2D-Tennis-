import type { CourtSurface, Difficulty, GameConfig, GameMode } from '../game/types';

interface TitleOverlayProps {
  config: GameConfig;
  bestMachineScore: number;
  onConfigChange: (partial: Partial<GameConfig>) => void;
  onStart: () => void;
}

const MODES: Array<{ id: GameMode; label: string; desc: string }> = [
  { id: 'match', label: 'Einzel-Match', desc: 'Gegen KI · bis 3 Spiele' },
  { id: 'machine', label: 'Ballmaschine', desc: 'Endlos-Rallye · Zielzonen' },
];

const SURFACES: Array<{ id: CourtSurface; label: string; swatch: string }> = [
  { id: 'clay', label: 'Sandplatz', swatch: '#c35b34' },
  { id: 'grass', label: 'Rasen', swatch: '#376f3b' },
  { id: 'hard', label: 'Hartplatz', swatch: '#2d5c88' },
];

const DIFFICULTIES: Array<{ id: Difficulty; label: string }> = [
  { id: 'anfaenger', label: 'Anfänger' },
  { id: 'club', label: 'Club' },
  { id: 'profi', label: 'Profi' },
];

export function TitleOverlay({
  config,
  bestMachineScore,
  onConfigChange,
  onStart,
}: TitleOverlayProps) {
  return (
    <div className="fixed inset-0 z-20 flex items-center pointer-events-none">
      {/* Left gradient scrim preserving live animated court visibility across the viewport */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(90deg, rgba(16, 24, 19, 0.94) 0%, rgba(16, 24, 19, 0.84) 36%, rgba(16, 24, 19, 0.25) 66%, rgba(16, 24, 19, 0.08) 100%)',
        }}
      />

      <div className="relative z-10 w-full max-w-[440px] px-7 sm:px-11 py-8 flex flex-col gap-7 pointer-events-auto">
        {/* Bespoke SVG Title Lockup */}
        <div className="flex flex-col gap-3">
          <svg
            viewBox="0 0 340 76"
            className="w-[290px] sm:w-[330px] h-auto"
            role="img"
            aria-label="Matchball"
          >
            {/* Minimalist court insignia */}
            <g transform="translate(2, 8)">
              <rect
                x="0"
                y="0"
                width="44"
                height="58"
                rx="3"
                fill="none"
                stroke="#f5f3ec"
                strokeWidth="2.4"
              />
              <line x1="0" y1="29" x2="44" y2="29" stroke="#d9ee45" strokeWidth="2.6" />
              <line x1="7" y1="0" x2="7" y2="58" stroke="#f5f3ec" strokeWidth="1.4" strokeOpacity="0.65" />
              <line x1="37" y1="0" x2="37" y2="58" stroke="#f5f3ec" strokeWidth="1.4" strokeOpacity="0.65" />
              <line x1="7" y1="15" x2="37" y2="15" stroke="#f5f3ec" strokeWidth="1.4" strokeOpacity="0.65" />
              <line x1="7" y1="43" x2="37" y2="43" stroke="#f5f3ec" strokeWidth="1.4" strokeOpacity="0.65" />
              <line x1="22" y1="15" x2="22" y2="43" stroke="#f5f3ec" strokeWidth="1.4" strokeOpacity="0.65" />
              <circle cx="31" cy="19" r="4.8" fill="#d9ee45" />
            </g>

            {/* Championship condensed wordmark */}
            <text
              x="62"
              y="55"
              fill="#f8f6f0"
              fontFamily="Barlow Condensed, sans-serif"
              fontWeight="800"
              fontSize="56"
              letterSpacing="1.5"
            >
              MATCHBALL
            </text>
            <line x1="63" y1="66" x2="296" y2="66" stroke="#d9ee45" strokeWidth="2.5" />
          </svg>

          <p className="text-sm sm:text-[15px] leading-relaxed text-[#d7ddd8] max-w-[36ch]">
            Sicht von oben in 2D: Lauf zum Ball, triff den perfekten Zeitpunkt und spiel präzise Winkel zurück.
          </p>
        </div>

        {/* Configuration Controls */}
        <div className="flex flex-col gap-5">
          {/* Mode */}
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-[#a3b1a8]">Spielmodus</span>
            <div className="grid grid-cols-2 gap-2 p-1 rounded-lg bg-[#0d1410] border border-white/10">
              {MODES.map((m) => {
                const active = config.mode === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => onConfigChange({ mode: m.id })}
                    className={`px-3 py-2.5 rounded-md text-left transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d9ee45] ${
                      active
                        ? 'bg-[#223128] text-[#f8f6f0]'
                        : 'text-[#9aa89f] hover:text-[#f8f6f0]'
                    }`}
                  >
                    <div className="text-sm font-semibold whitespace-nowrap">{m.label}</div>
                    <div className="text-[11px] text-[#a3b1a8] mt-0.5 whitespace-nowrap">
                      {m.desc}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Surface */}
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-[#a3b1a8]">Platzbelag</span>
            <div className="grid grid-cols-3 gap-1.5 p-1 rounded-lg bg-[#0d1410] border border-white/10">
              {SURFACES.map((s) => {
                const active = config.surface === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => onConfigChange({ surface: s.id })}
                    className={`flex items-center justify-center gap-2 px-2.5 py-2 rounded-md text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d9ee45] ${
                      active
                        ? 'bg-[#223128] text-[#f8f6f0]'
                        : 'text-[#9aa89f] hover:text-[#f8f6f0]'
                    }`}
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-xs shrink-0 border border-white/30"
                      style={{ backgroundColor: s.swatch }}
                      aria-hidden="true"
                    />
                    <span>{s.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Difficulty */}
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-[#a3b1a8]">Tempo &amp; Gegner</span>
            <div className="grid grid-cols-3 gap-1.5 p-1 rounded-lg bg-[#0d1410] border border-white/10">
              {DIFFICULTIES.map((d) => {
                const active = config.difficulty === d.id;
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => onConfigChange({ difficulty: d.id })}
                    className={`px-3 py-2 rounded-md text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d9ee45] ${
                      active
                        ? 'bg-[#223128] text-[#f8f6f0]'
                        : 'text-[#9aa89f] hover:text-[#f8f6f0]'
                    }`}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Primary CTA */}
        <div className="flex flex-col gap-3 pt-1">
          <button
            type="button"
            onClick={onStart}
            className="w-full py-3.5 px-6 rounded-lg bg-[#d9ee45] hover:bg-[#e5f665] active:scale-[0.99] text-[#131d16] font-display font-extrabold text-2xl tracking-wide transition-transform cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ffffff] whitespace-nowrap"
          >
            Spiel starten
          </button>

          {config.mode === 'machine' && bestMachineScore > 0 && (
            <div className="text-xs text-[#b5c2b9] tabular-nums">
              Rekord Ballmaschine: <span className="font-semibold text-[#f8f6f0]">{bestMachineScore}</span> Punkte
            </div>
          )}

          {/* Single flat control-hint line */}
          <p className="text-xs text-[#9eaba2] pt-1 leading-relaxed">
            WASD Bewegen · Maus Richtung &amp; Schwung · Linksklick Scharf · Rechtsklick Volley (halten = schärfer)
          </p>
        </div>
      </div>
    </div>
  );
}
