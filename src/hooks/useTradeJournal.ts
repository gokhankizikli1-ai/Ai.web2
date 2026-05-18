import { useState, useEffect, useCallback } from 'react';
import type { TradeJournalEntry, JournalAnalytics, JournalSetupStat } from '@/types';

/**
 * Trade journal — localStorage only (no backend / DB / env changes).
 * Reusable hook + a pure analytics function. All analytics are computed
 * from the user's OWN real entries — nothing fabricated; honest
 * "insufficient data" until there are enough closed trades.
 */
const LS_KEY = 'korvix.journal.v1';

function loadEntries(): TradeJournalEntry[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const a = JSON.parse(raw);
      if (Array.isArray(a)) return a as TradeJournalEntry[];
    }
  } catch { /* ignore */ }
  return [];
}

function plannedRR(e: TradeJournalEntry): number | null {
  const { entry, stop, target, direction } = e;
  if (typeof entry !== 'number' || typeof stop !== 'number' || typeof target !== 'number') {
    return null;
  }
  const short = direction === 'short';
  const risk = short ? stop - entry : entry - stop;
  const reward = short ? entry - target : target - entry;
  if (risk <= 0 || reward <= 0) return null;
  return Math.round((reward / risk) * 100) / 100;
}

export function computeJournalAnalytics(entries: TradeJournalEntry[]): JournalAnalytics {
  const total = entries.length;
  const closedEntries = entries.filter((e) => e.result && e.result !== 'open');
  const closed = closedEntries.length;
  const open = total - closed;
  const wins = closedEntries.filter((e) => e.result === 'win').length;
  const losses = closedEntries.filter((e) => e.result === 'loss').length;
  const breakeven = closedEntries.filter((e) => e.result === 'breakeven').length;
  const winrate = closed > 0 ? Math.round((wins / closed) * 100) : 0;

  const rrs = entries.map(plannedRR).filter((r): r is number => r !== null);
  const avgRR = rrs.length ? Math.round((rrs.reduce((a, b) => a + b, 0) / rrs.length) * 100) / 100 : 0;

  const pnls = closedEntries
    .map((e) => e.pnl)
    .filter((p): p is number => typeof p === 'number');
  const expectancy = pnls.length
    ? Math.round((pnls.reduce((a, b) => a + b, 0) / pnls.length) * 100) / 100
    : 0;

  const groups = new Map<string, TradeJournalEntry[]>();
  for (const e of entries) {
    const key = (e.setupType || 'untagged').trim() || 'untagged';
    const arr = groups.get(key) || [];
    arr.push(e);
    groups.set(key, arr);
  }
  const bySetup: JournalSetupStat[] = [];
  for (const [setup, arr] of groups) {
    const cl = arr.filter((e) => e.result && e.result !== 'open');
    const w = cl.filter((e) => e.result === 'win').length;
    const srrs = arr.map(plannedRR).filter((r): r is number => r !== null);
    bySetup.push({
      setup,
      trades: arr.length,
      wins: w,
      winrate: cl.length ? Math.round((w / cl.length) * 100) : 0,
      avgRR: srrs.length ? Math.round((srrs.reduce((a, b) => a + b, 0) / srrs.length) * 100) / 100 : 0,
    });
  }
  bySetup.sort((a, b) => b.winrate - a.winrate || b.trades - a.trades);
  const ranked = bySetup.filter((s) => s.trades >= 2 && s.setup !== 'untagged');
  const bestSetup = ranked.length ? ranked[0].setup : null;
  const worstSetup = ranked.length > 1 ? ranked[ranked.length - 1].setup : null;

  const rrBuckets = [
    { label: '<1', count: rrs.filter((r) => r < 1).length },
    { label: '1–2', count: rrs.filter((r) => r >= 1 && r < 2).length },
    { label: '2–3', count: rrs.filter((r) => r >= 2 && r < 3).length },
    { label: '3+', count: rrs.filter((r) => r >= 3).length },
  ];

  const perDay = new Map<string, number>();
  for (const e of entries) {
    const day = (e.openedAt || '').slice(0, 10);
    if (day) perDay.set(day, (perDay.get(day) || 0) + 1);
  }
  const overtradingDays = [...perDay.values()].filter((c) => c > 5).length;

  const reliable = closed >= 5;
  const insights: string[] = [];
  if (!reliable) {
    insights.push(`Not enough closed trades for reliable analytics (${closed}/5). Log and close more trades.`);
  } else {
    insights.push(`Win rate ${winrate}% over ${closed} closed trades${breakeven ? ` (${breakeven} breakeven)` : ''}.`);
    if (bestSetup) {
      const b = bySetup.find((s) => s.setup === bestSetup);
      if (b) insights.push(`You perform best on "${bestSetup}" setups — ${b.winrate}% over ${b.trades}.`);
    }
    if (worstSetup && worstSetup !== bestSetup) {
      const w = bySetup.find((s) => s.setup === worstSetup);
      if (w) insights.push(`Losses cluster in "${worstSetup}" setups — ${w.winrate}% over ${w.trades}.`);
    }
    if (pnls.length) {
      insights.push(`Expectancy ${expectancy >= 0 ? '+' : ''}${expectancy} avg P&L per closed trade.`);
    }
    if (avgRR) insights.push(`Average planned R:R ${avgRR}.`);
    if (overtradingDays > 0) {
      insights.push(`Possible overtrading: ${overtradingDays} day(s) with >5 trades opened.`);
    }
  }

  return {
    total, open, closed, wins, losses, breakeven, winrate, avgRR,
    expectancy, bestSetup, worstSetup, bySetup, rrBuckets,
    overtradingDays, insights, reliable,
  };
}

export function useTradeJournal() {
  const [entries, setEntries] = useState<TradeJournalEntry[]>(loadEntries);

  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(entries)); } catch { /* ignore */ }
  }, [entries]);

  const addEntry = useCallback((e: Omit<TradeJournalEntry, 'id' | 'openedAt'> & Partial<Pick<TradeJournalEntry, 'openedAt'>>) => {
    const id = (crypto.randomUUID ? crypto.randomUUID() : `j-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    const entry: TradeJournalEntry = {
      result: 'open',
      ...e,
      id,
      openedAt: e.openedAt || new Date().toISOString(),
    };
    setEntries((prev) => [entry, ...prev]);
    return id;
  }, []);

  const updateEntry = useCallback((id: string, patch: Partial<TradeJournalEntry>) => {
    setEntries((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }, []);

  const closeEntry = useCallback((id: string, result: TradeJournalEntry['result'], pnl?: number | null) => {
    setEntries((prev) => prev.map((x) => (
      x.id === id ? { ...x, result, pnl: pnl ?? x.pnl ?? null, closedAt: new Date().toISOString() } : x
    )));
  }, []);

  const removeEntry = useCallback((id: string) => {
    setEntries((prev) => prev.filter((x) => x.id !== id));
  }, []);

  return { entries, addEntry, updateEntry, closeEntry, removeEntry };
}
