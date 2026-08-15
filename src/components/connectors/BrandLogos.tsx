/**
 * Official service logos for connector cards, inlined as SVG so we add NO icon
 * dependency and never render a generic Lucide glyph as a brand mark.
 *
 *  - GmailLogo  — Google's multi-colour envelope "M" (official brand colours).
 *  - GithubLogo — GitHub's Octocat mark. Monochrome by design; uses
 *                 `currentColor` so the card controls the tone (white on dark).
 *  - VercelLogo — Vercel's triangle mark. Monochrome by design (that IS the
 *                 brand); uses `currentColor` like the GitHub mark.
 *  - GoogleCalendarLogo — Google Calendar's rounded square with the folded
 *                 corner and the blue "31" ticket, in the official brand
 *                 colours (the same multi-colour treatment as GmailLogo, so the
 *                 two Google connectors read as a family).
 *  - SlackLogo  — Slack's four-colour hash/pinwheel mark, drawn from the four
 *                 official brand colours. Multi-colour like the Google marks,
 *                 so it reads as a real brand mark and not a Lucide glyph.
 *
 * All are decorative next to a visible text label, so they carry
 * aria-hidden and no title.
 */

export function GmailLogo({ size = 28, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path fill="#4caf50" d="M45 16.2l-5 2.75-5 4.75L35 40h7c1.657 0 3-1.343 3-3V16.2z" />
      <path fill="#1e88e5" d="M3 16.2l3.614 1.71L13 23.7V40H6c-1.657 0-3-1.343-3-3V16.2z" />
      <polygon fill="#e53935" points="35,11.2 24,19.45 13,11.2 12,17 13,23.7 24,31.95 35,23.7 36,17" />
      <path fill="#c62828" d="M3 12.298V16.2l10 7.5V11.2L9.876 8.859C9.132 8.301 8.228 8 7.298 8C4.924 8 3 9.924 3 12.298z" />
      <path fill="#fbc02d" d="M45 12.298V16.2l-10 7.5V11.2l3.124-2.341C38.868 8.301 39.772 8 40.702 8C43.076 8 45 9.924 45 12.298z" />
    </svg>
  );
}

export function GithubLogo({ size = 28, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
      focusable="false"
      fill="currentColor"
    >
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

export function VercelLogo({ size = 28, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
      focusable="false"
      fill="currentColor"
    >
      <path d="M12 2 22.5 20.5H1.5L12 2z" />
    </svg>
  );
}

export function GoogleCalendarLogo({ size = 28, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {/* White page. The four Google brand colours sit in the corners of the
          frame, and the blue "31" is the mark's defining feature. */}
      <rect x="7" y="7" width="34" height="34" rx="5" fill="#ffffff" />
      <path fill="#4285f4" d="M7 12a5 5 0 0 1 5-5h5v9H7z" />
      <path fill="#ea4335" d="M31 7h5a5 5 0 0 1 5 5v4h-10z" />
      <path fill="#fbbc04" d="M41 32v4a5 5 0 0 1-5 5h-5v-9z" />
      <path fill="#34a853" d="M17 41h-5a5 5 0 0 1-5-5v-4h10z" />
      <text
        x="24"
        y="24"
        textAnchor="middle"
        dominantBaseline="central"
        fill="#1a73e8"
        fontFamily="Helvetica, Arial, sans-serif"
        fontSize="17"
        fontWeight="700"
      >
        31
      </text>
    </svg>
  );
}

export function SlackLogo({ size = 28, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {/* Slack's mark is four two-part arms rotated around a centre. Each arm
          is one brand colour: a rounded bar plus the small "cap" that turns the
          pinwheel. */}
      <path fill="#E01E5A" d="M5.04 15.17a2.53 2.53 0 1 1-2.52-2.53h2.52v2.53z" />
      <path fill="#E01E5A" d="M6.31 15.17a2.53 2.53 0 0 1 5.05 0v6.31a2.53 2.53 0 0 1-5.05 0v-6.31z" />
      <path fill="#36C5F0" d="M8.83 5.04a2.53 2.53 0 1 1 2.53-2.52v2.52H8.83z" />
      <path fill="#36C5F0" d="M8.83 6.31a2.53 2.53 0 0 1 0 5.05H2.52a2.53 2.53 0 0 1 0-5.05h6.31z" />
      <path fill="#2EB67D" d="M18.96 8.83a2.53 2.53 0 1 1 2.52 2.53h-2.52V8.83z" />
      <path fill="#2EB67D" d="M17.69 8.83a2.53 2.53 0 0 1-5.05 0V2.52a2.53 2.53 0 0 1 5.05 0v6.31z" />
      <path fill="#ECB22E" d="M15.17 18.96a2.53 2.53 0 1 1-2.53 2.52v-2.52h2.53z" />
      <path fill="#ECB22E" d="M15.17 17.69a2.53 2.53 0 0 1 0-5.05h6.31a2.53 2.53 0 0 1 0 5.05h-6.31z" />
    </svg>
  );
}
