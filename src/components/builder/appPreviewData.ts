// appPreviewData — small, deterministic helpers that turn a free-text idea
// into cosmetic dashboard details (app name, mock stat cards) for the App
// Builder's premium preview shell. Nothing here is sent to or read from the
// backend — it is purely decorative chrome around the real PreviewResult.
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

const STOPWORDS = new Set([
  'a', 'an', 'the', 'for', 'build', 'create', 'design', 'make', 'app',
  'application', 'to', 'that', 'with', 'and', 'of', 'platform',
]);

export function appNameFromIdea(idea: string): string {
  const words = idea
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !STOPWORDS.has(w.toLowerCase()));
  const picked = words.slice(0, 2);
  if (picked.length === 0) return 'Your App';
  return picked.map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
}

export interface MockStat {
  label: string;
  value: string;
  delta: string;
  positive: boolean;
}

const STAT_LABELS: [string, string, string] = ['Active Users', 'This Month', 'Growth Rate'];

export function mockStatsFromIdea(idea: string): MockStat[] {
  const seed = hashString(idea || 'korvix');
  const users = 800 + (seed % 9200);
  const revenue = 2 + ((seed >> 3) % 48);
  const growth = 4 + ((seed >> 5) % 36);
  return [
    { label: STAT_LABELS[0], value: users.toLocaleString(), delta: `+${(seed % 12) + 2}%`, positive: true },
    { label: STAT_LABELS[1], value: `$${revenue}.${(seed % 9)}k`, delta: `+${(seed % 8) + 3}%`, positive: true },
    { label: STAT_LABELS[2], value: `${growth}%`, delta: growth > 20 ? '+steady' : '-cooling', positive: growth > 20 },
  ];
}
