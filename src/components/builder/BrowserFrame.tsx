// BrowserFrame — shared premium chrome for generated Website/App previews.
//
// Renders a browser-style top bar (window dots, fake URL, viewport controls)
// wrapping arbitrary preview content. Used by WebsiteBuilder and AppBuilder
// so both surfaces share one "real product preview" look instead of each
// hand-rolling its own frame.
import { useState } from 'react';
import { Lock, Monitor, Tablet, Smartphone } from 'lucide-react';

export type Viewport = 'desktop' | 'tablet' | 'mobile';

const VIEWPORT_WIDTH: Record<Viewport, string> = {
  desktop: '100%',
  tablet: '834px',
  mobile: '390px',
};

const ACCENT_HEX: Record<string, string> = {
  violet: '#60A5FA',
  indigo: '#60A5FA',
};

interface BrowserFrameProps {
  url: string;
  children: React.ReactNode;
  showViewportControls?: boolean;
  accent?: 'violet' | 'indigo';
  /** Hex color, overrides `accent` — used by surfaces with a dynamic brand palette (e.g. Website Builder's Design Brief color direction). */
  accentColor?: string;
}

export default function BrowserFrame({
  url, children, showViewportControls = true, accent = 'violet', accentColor,
}: BrowserFrameProps) {
  const [viewport, setViewport] = useState<Viewport>('desktop');
  const activeHex = accentColor || ACCENT_HEX[accent] || ACCENT_HEX.violet;

  return (
    <div
      className="rounded-2xl overflow-hidden border border-white/[0.06] shadow-2xl shadow-black/40"
      style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01))' }}
    >
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-white/[0.06] bg-white/[0.02]">
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]/80" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#febc2e]/80" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#28c840]/80" />
        </div>

        <div className="flex-1 flex items-center justify-center min-w-0">
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-black/30 border border-white/[0.05] max-w-full">
            <Lock className="w-2.5 h-2.5 text-[#94A3B8] shrink-0" />
            <span className="text-[11px] text-[#94A3B8] truncate">{url}</span>
          </div>
        </div>

        {showViewportControls && (
          <div className="hidden sm:flex items-center gap-0.5 rounded-lg bg-white/[0.02] p-0.5 shrink-0">
            {([['desktop', Monitor], ['tablet', Tablet], ['mobile', Smartphone]] as const).map(([v, Icon]) => (
              <button
                key={v}
                onClick={() => setViewport(v)}
                title={v}
                className={`p-1.5 rounded-md transition-colors ${viewport === v ? 'bg-white/[0.05]' : 'text-[#94A3B8] hover:text-[#CBD5E1]'}`}
                style={viewport === v ? { color: activeHex } : undefined}
              >
                <Icon className="w-3 h-3" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Viewport body */}
      <div className="bg-black/20 flex justify-center overflow-x-auto">
        <div
          className="w-full transition-all duration-300 ease-out"
          style={{ maxWidth: VIEWPORT_WIDTH[viewport] }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
