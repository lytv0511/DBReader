import { useEffect, useState } from 'react';
import { Database } from 'lucide-react';
import type { ThemeMode } from '../types';

interface WorkspaceProps {
  tabs: { mode: string; label: string; icon: React.ReactNode; enabled: boolean }[];
  onNavigate: (mode: string) => void;
  theme: ThemeMode;
}

const THEME_GRADIENTS: Record<string, string> = {
  dark: 'from-blue-950 via-blue-900 to-indigo-950',
  light: 'from-sky-400 via-blue-500 to-indigo-600',
  system: 'from-blue-950 via-blue-900 to-indigo-950',
  aurora: 'from-fuchsia-500 via-purple-600 to-indigo-700',
  sunset: 'from-orange-500 via-rose-500 to-pink-600',
  ocean: 'from-cyan-500 via-teal-600 to-blue-700',
  forest: 'from-emerald-500 via-green-600 to-teal-700',
  candy: 'from-pink-400 via-rose-500 to-fuchsia-600',
  gold: 'from-yellow-400 via-amber-500 to-orange-600',
  midnight: 'from-indigo-600 via-purple-800 to-slate-950',
  lava: 'from-red-500 via-orange-600 to-yellow-500',
};

function ForestArt() {
  const back: number[][] = [
    [30, 300, 90, 118, 150, 300],
    [180, 300, 240, 132, 300, 300],
    [330, 300, 390, 122, 450, 300],
    [480, 300, 540, 128, 600, 300],
    [630, 300, 690, 118, 750, 300],
    [780, 300, 840, 126, 900, 300],
    [930, 300, 990, 120, 1050, 300],
    [1080, 300, 1140, 134, 1200, 300],
  ];
  const front: number[][] = [
    [10, 300, 75, 150, 140, 300],
    [130, 300, 200, 160, 270, 300],
    [260, 300, 340, 148, 420, 300],
    [410, 300, 480, 162, 550, 300],
    [540, 300, 620, 152, 700, 300],
    [690, 300, 760, 166, 830, 300],
    [820, 300, 900, 150, 980, 300],
    [970, 300, 1040, 168, 1110, 300],
    [1100, 300, 1170, 156, 1240, 300],
  ];
  return (
    <svg className="absolute inset-x-0 bottom-0 w-full h-[80%] pointer-events-none" viewBox="0 0 1200 300" preserveAspectRatio="xMidYMax slice">
      <g fill="#047857" opacity="0.5">
        {back.map((t, i) => <polygon key={`b${i}`} points={t.join(' ')} />)}
      </g>
      <g fill="#064e3b" opacity="0.85">
        {front.map((t, i) => <polygon key={`f${i}`} points={t.join(' ')} />)}
      </g>
    </svg>
  );
}

function LavaArt() {
  return (
    <svg className="absolute inset-x-0 bottom-0 w-full h-[80%] pointer-events-none" viewBox="0 0 1200 300" preserveAspectRatio="xMidYMax slice">
      <path
        d="M0,300 L0,250 L200,250 L300,120 L430,270 L520,270 L620,150 L740,270 L860,270 L960,150 L1080,270 L1200,250 L1200,300 Z"
        fill="#450a0a"
      />
      <path
        d="M522,300 L600,180 L678,300 Z"
        fill="#fbbf24"
        opacity="0.95"
      />
      <path
        d="M440,300 L400,240 M760,300 L800,250 M1000,300 L960,230"
        stroke="#fb923c"
        strokeWidth="7"
        strokeLinecap="round"
        fill="none"
        opacity="0.9"
      />
      {[[410, 190], [430, 215], [770, 200], [790, 225], [540, 265], [660, 265]].map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r="5" fill="#fde047" />
      ))}
      {[[640, 210], [720, 205], [820, 190], [900, 220], [370, 225], [500, 235]].map(([cx, cy], i) => (
        <circle key={`e${i}`} cx={cx} cy={cy} r="3" fill="#fb923c" opacity="0.9" />
      ))}
    </svg>
  );
}

function OceanArt() {
  return (
    <svg className="absolute inset-x-0 bottom-0 w-full h-[55%] pointer-events-none" viewBox="0 0 1200 200" preserveAspectRatio="xMidYMax slice">
      <path d="M0,120 Q100,90 200,120 T400,120 T600,120 T800,120 T1000,120 T1200,120 L1200,200 L0,200 Z" fill="#0e7490" opacity="0.55" />
      <path d="M0,150 Q120,120 240,150 T480,150 T720,150 T960,150 T1200,150 L1200,200 L0,200 Z" fill="#155e75" opacity="0.7" />
      <circle cx="180" cy="80" r="26" fill="#fef3c7" opacity="0.9" />
      <path d="M180,54 a26,26 0 0 1 0,52 Z" fill="#fb923c" opacity="0.85" />
    </svg>
  );
}

function SunsetArt() {
  return (
    <svg className="absolute inset-x-0 bottom-0 w-full h-[70%] pointer-events-none" viewBox="0 0 1200 280" preserveAspectRatio="xMidYMax slice">
      <ellipse cx="600" cy="330" rx="420" ry="130" fill="#fb923c" opacity="0.25" />
      <ellipse cx="600" cy="300" rx="300" ry="95" fill="#f97316" />
      <path d="M0,240 Q150,180 300,240 T600,240 T900,240 T1200,240 L1200,280 L0,280 Z" fill="#9f1239" />
      <path d="M0,210 Q160,170 320,210 T640,210 T960,210 T1200,210" stroke="#be185d" strokeWidth="6" fill="none" opacity="0.6" />
      <path d="M120,140 Q160,120 200,140 L320,140 Q300,120 340,120 L480,120 L480,180 L120,180 Z" fill="#fecdd3" opacity="0.8" />
      <path d="M900,110 Q950,90 1000,110 L1100,110 L1100,170 L900,170 Z" fill="#fecdd3" opacity="0.65" />
    </svg>
  );
}

function MidnightArt() {
  const stars = [
    [80, 70], [160, 120], [260, 60], [340, 140], [430, 85], [540, 50],
    [620, 130], [710, 70], [800, 110], [900, 55], [1000, 125], [1120, 80],
    [180, 190], [470, 175], [850, 185],
  ];
  return (
    <svg className="absolute inset-x-0 bottom-0 w-full h-full pointer-events-none" viewBox="0 0 1200 220" preserveAspectRatio="xMidYMax slice">
      <path d="M960,40 a46,46 0 1 0 46,46 a38,38 0 1 1 -46,-46" fill="#e0e7ff" opacity="0.85" />
      {stars.map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r={i % 3 === 0 ? 2.5 : 1.6} fill="#e0e7ff" opacity="0.9" />
      ))}
      {[[250, 40], [560, 30], [820, 30], [1050, 45]].map(([cx, cy], i) => (
        <path key={`t${i}`} d={`M${cx},${cy} L${cx + 9},${cy - 9} L${cx + 18},${cy}`} stroke="#e0e7ff" strokeWidth="1.5" fill="none" opacity="0.8" />
      ))}
    </svg>
  );
}

function AuroraArt() {
  return (
    <svg className="absolute inset-x-0 bottom-0 w-full h-full pointer-events-none" viewBox="0 0 1200 220" preserveAspectRatio="xMidYMax slice">
      <path d="M0,220 C150,120 320,90 480,180 C640,-20 820,90 980,40 C1080,10 1160,60 1200,90 L1200,220 Z" fill="#a855f7" opacity="0.35" />
      <path d="M0,200 C140,150 300,150 460,220 C620,70 800,140 980,100 C1080,80 1160,120 1200,140 L1200,220 Z" fill="#ec4899" opacity="0.3" />
      <path d="M0,160 C180,70 380,70 560,120 C740,170 940,50 1140,90 L1200,110 L1200,220 L0,220 Z" fill="#34d399" opacity="0.18" />
    </svg>
  );
}

function CandyArt() {
  const candies = [
    { x: 240, y: 118, c: '#f43f5e' }, { x: 460, y: 132, c: '#8b5cf6' },
    { x: 680, y: 124, c: '#10b981' }, { x: 900, y: 136, c: '#f59e0b' },
  ];
  return (
    <svg className="absolute inset-x-0 bottom-0 w-full h-full pointer-events-none" viewBox="0 0 1200 240" preserveAspectRatio="xMidYMid slice">
      {candies.map((fro, i) => (
        <g key={i} transform={`translate(${fro.x} ${fro.y}) rotate(${i % 3 ? 15 : -15})`} opacity="0.7">
          <rect x="-16" y="-10" width="32" height="20" rx="6" fill={fro.c} />
          <path d="M-16,-5 h32 M-16,5 h32" stroke="#fdf2f8" strokeWidth="2" opacity="0.6" />
          <path d="M-16,-10 L-26,-15 L-22,-5 Z M16,-10 L26,-15 L22,-5 Z M-16,10 L-26,15 L-22,5 Z M16,10 L26,15 L22,5 Z" fill={fro.c} />
        </g>
      ))}
    </svg>
  );
}

function GoldSparkleArt() {
  return (
    <svg className="absolute inset-x-0 bottom-0 w-full h-full pointer-events-none" viewBox="0 0 1200 220" preserveAspectRatio="xMidYMax slice">
      {[[90, 140], [210, 110], [330, 150], [480, 120], [600, 160], [760, 110], [900, 140], [1030, 120], [1140, 150]].map(([cx, cy], i) => (
        <path key={i} d={`M${cx},${cy - 12} L${cx + 3},${cy - 3} L${cx + 12},${cy} L${cx + 3},${cy + 3} L${cx},${cy + 12} L${cx - 3},${cy + 3} L${cx - 12},${cy} L${cx - 3},${cy - 3} Z`} fill="#fde68a" opacity="0.45" />
      ))}
    </svg>
  );
}

function ThemeArt({ theme }: { theme: string }) {
  switch (theme) {
    case 'forest': return <ForestArt />;
    case 'lava': return <LavaArt />;
    case 'gold': return <GoldSparkleArt />;
    case 'ocean': return <OceanArt />;
    case 'sunset': return <SunsetArt />;
    case 'midnight': return <MidnightArt />;
    case 'aurora': return <AuroraArt />;
    case 'candy': return <CandyArt />;
    default: return null;
  }
}

export default function Workspace({ tabs, onNavigate, theme }: WorkspaceProps) {
  const gradient = THEME_GRADIENTS[theme] ?? THEME_GRADIENTS.dark;
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="flex-1 overflow-y-auto bg-bg-primary text-text-primary">
      <div className={`relative overflow-hidden bg-gradient-to-br ${gradient}`}>
        <ThemeArt theme={theme} />
        <div className="relative flex items-center justify-between px-10 py-8">
          <div className="flex items-center gap-5">
            <div className="w-16 h-16 rounded-2xl bg-white/15 backdrop-blur-sm border border-white/20 shadow-lg grid place-items-center">
              <Database size={34} className="text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-black tracking-tight text-white">DBReader</h1>
              <p className="text-sm text-white/70 font-medium">Workspace</p>
            </div>
          </div>
          <div className="text-right text-white">
            <div className="text-3xl font-black tabular-nums">
              {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>
            <div className="text-sm text-white/80">
              {now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
            </div>
          </div>
        </div>
      </div>

      <div className="p-8">
        {tabs.length === 0 ? (
          <p className="text-sm text-text-secondary text-center py-16">No tabs enabled</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {tabs.map((tab) => (
              <button
                key={tab.mode}
                onClick={() => onNavigate(tab.mode)}
                className="group flex flex-col items-center gap-3 px-4 py-6 rounded-2xl bg-bg-secondary border border-border transition-all hover:bg-bg-hover hover:border-accent/40 hover:scale-[1.03] active:scale-95"
              >
                <span className="grid place-items-center w-14 h-14 rounded-xl bg-accent/10 text-accent group-hover:bg-accent group-hover:text-white transition-colors">
                  {tab.icon}
                </span>
                <span className="text-sm font-semibold text-text-primary">{tab.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}