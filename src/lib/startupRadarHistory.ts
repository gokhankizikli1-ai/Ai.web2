/**
 * Startup Radar — local analysis history.
 *
 * Stores the last 5 reports in localStorage so a founder can flip between
 * recent analyses without re-hitting the API. The original request is stored
 * with new entries so restoring history also restores form inputs.
 */
import type { MarketComplaintReport, MarketComplaintRequest } from './startupMarketApi';

const STORAGE_KEY = 'korvix_startup_radar_history';
const MAX_ENTRIES = 5;

export interface RadarHistoryEntry {
  savedAt: string; // ISO — when the user ran the analysis
  report: MarketComplaintReport;
  request?: MarketComplaintRequest;
}

export function loadRadarHistory(): RadarHistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is RadarHistoryEntry =>
        !!e && typeof e === 'object' && !!e.report?.query && !!e.report?.summary,
    );
  } catch {
    return [];
  }
}

/** Prepend a report (deduped by query — a re-run replaces the old entry)
 * and return the updated list. */
export function saveRadarReport(
  report: MarketComplaintReport,
  request?: MarketComplaintRequest,
): RadarHistoryEntry[] {
  const entry: RadarHistoryEntry = {
    savedAt: new Date().toISOString(),
    report,
    request,
  };
  const next = [
    entry,
    ...loadRadarHistory().filter(
      (e) => e.report.query.toLowerCase() !== report.query.toLowerCase(),
    ),
  ].slice(0, MAX_ENTRIES);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch { /* storage full / disabled — history is best-effort */ }
  return next;
}

export function clearRadarHistory(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch { /* ignore */ }
}
