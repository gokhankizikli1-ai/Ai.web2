/**
 * BrandLogo — the single shared Korvix brand mark + wordmark.
 *
 * Design (from the approved v8 landing): a dark rounded-square "K" mark
 * plus a "KorvixAI" wordmark. The mark itself is dark-on-dark-square and
 * reads on any background; only the wordmark color changes with context:
 *
 *   tone="onLight"  → dark wordmark   (porcelain / white backgrounds)
 *   tone="onDark"   → light wordmark  (ink / dark app backgrounds)
 *
 * Presentational only (renders a span) — wrap in a <Link>/<a> at the call
 * site if it should navigate. This guarantees the logo is identical and
 * always readable across landing, auth, and the app shell.
 */

interface BrandLogoProps {
  /** Background the logo sits on — controls wordmark contrast. */
  tone?: 'onLight' | 'onDark';
  /** Square mark size in px. */
  markSize?: number;
  /** Wordmark font size in px. */
  wordSize?: number;
  /** Hide the wordmark and render the mark alone. */
  markOnly?: boolean;
  className?: string;
}

export default function BrandLogo({
  tone = 'onLight',
  markSize = 29,
  wordSize = 17.5,
  markOnly = false,
  className = '',
}: BrandLogoProps) {
  const wordColor = tone === 'onDark' ? '#F5F7FA' : '#0F1729';
  const aiColor = tone === 'onDark' ? '#5A6774' : '#64748B';

  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <span
        className="grid shrink-0 place-items-center rounded-lg"
        style={{
          width: markSize,
          height: markSize,
          background: 'linear-gradient(158deg, rgba(32,41,51,0.5) 0%, #0B0E12 100%), #12171E',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.10), 0 2px 6px rgba(16,24,39,0.20)',
        }}
      >
        <span
          className="font-mono font-bold text-[#EDF1F5]"
          style={{ fontSize: Math.round(markSize * 0.52), lineHeight: 1 }}
        >
          K
        </span>
      </span>
      {!markOnly && (
        <span
          className="font-bold tracking-tight"
          style={{ fontSize: wordSize, color: wordColor, letterSpacing: '-0.018em' }}
        >
          Korvix<span style={{ color: aiColor, fontWeight: 600 }}>AI</span>
        </span>
      )}
    </span>
  );
}
