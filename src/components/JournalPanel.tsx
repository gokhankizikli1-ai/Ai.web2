import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Plus, X, Trash2, BookOpen, TrendingUp, TrendingDown } from 'lucide-react';
import type { TradeJournalEntry } from '@/types';
import { computeJournalAnalytics } from '@/hooks/useTradeJournal';
import { useToast } from '@/hooks/useToast';

type Journal = {
  entries: TradeJournalEntry[];
  addEntry: (e: Omit<TradeJournalEntry, 'id' | 'openedAt'> & Partial<Pick<TradeJournalEntry, 'openedAt'>>) => string;
  updateEntry: (id: string, patch: Partial<TradeJournalEntry>) => void;
  closeEntry: (id: string, result: TradeJournalEntry['result'], pnl?: number | null) => void;
  removeEntry: (id: string) => void;
};

function numOrUndef(v: string): number | undefined {
  const t = v.trim();
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

function Tile({ label, value, tone = 'text-white' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="p-3 rounded-xl border border-white/[0.04] bg-white/[0.015] text-center">
      <p className={`text-[16px] font-semibold ${tone}`}>{value}</p>
      <p className="text-[9px] text-slate-600 mt-0.5">{label}</p>
    </div>
  );
}

export default function JournalPanel({ journal }: { journal: Journal }) {
  const { entries, addEntry, closeEntry, removeEntry, updateEntry } = journal;
  const { addToast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [f, setF] = useState({
    symbol: '', direction: 'long', entry: '', stop: '', target: '',
    timeframe: '', setupType: '', confidence: '', thesis: '',
  });

  const a = useMemo(() => computeJournalAnalytics(entries), [entries]);
  const hasExpectancy = entries.some((e) => e.result && e.result !== 'open' && typeof e.pnl === 'number');

  const submit = () => {
    const symbol = f.symbol.trim().toUpperCase();
    if (!symbol || !/^[A-Z0-9.\-]{1,15}$/.test(symbol)) {
      addToast('Enter a valid ticker (e.g. AAPL, BTCUSDT)', 'error');
      return;
    }
    if (!f.thesis.trim()) {
      addToast('Add a short thesis for the trade', 'error');
      return;
    }
    addEntry({
      symbol,
      direction: f.direction === 'short' ? 'short' : 'long',
      entry: numOrUndef(f.entry),
      stop: numOrUndef(f.stop),
      target: numOrUndef(f.target),
      timeframe: f.timeframe.trim() || undefined,
      setupType: f.setupType.trim() || undefined,
      confidenceAtEntry: numOrUndef(f.confidence) ?? null,
      thesis: f.thesis.trim(),
      result: 'open',
    });
    setF({ symbol: '', direction: 'long', entry: '', stop: '', target: '', timeframe: '', setupType: '', confidence: '', thesis: '' });
    setShowForm(false);
    addToast(`${symbol} logged to journal`, 'success');
  };

  const inputCls = 'h-8 px-2.5 rounded-lg bg-white/[0.02] border border-white/[0.04] text-[11px] text-slate-300 placeholder:text-slate-700 focus:outline-none focus:border-emerald-500/20 transition-all';

  return (
    <>
      {/* Header / add toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BookOpen className="w-3.5 h-3.5 text-slate-500" />
          <span className="text-[12px] font-medium text-slate-300">Trade journal</span>
          <span className="text-[10px] text-slate-600">· {a.total} logged · saved locally</span>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="h-7 px-2.5 flex items-center gap-1 rounded-lg bg-emerald-500/[0.06] border border-emerald-500/10 text-[11px] text-emerald-400 hover:bg-emerald-500/[0.1] transition-all"
        >
          {showForm ? <X className="w-3 h-3" /> : <Plus className="w-3 h-3" />}{showForm ? 'Close' : 'Log trade'}
        </button>
      </div>

      {/* Add form */}
      {showForm && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="rounded-xl border border-white/[0.05] bg-white/[0.015] p-3 space-y-2 overflow-hidden"
        >
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <input className={inputCls} placeholder="Symbol*" value={f.symbol}
              onChange={(e) => setF({ ...f, symbol: e.target.value })} />
            <select className={inputCls} value={f.direction}
              onChange={(e) => setF({ ...f, direction: e.target.value })}>
              <option value="long">Long</option>
              <option value="short">Short</option>
            </select>
            <input className={inputCls} placeholder="Timeframe" value={f.timeframe}
              onChange={(e) => setF({ ...f, timeframe: e.target.value })} />
            <input className={inputCls} placeholder="Entry" value={f.entry}
              onChange={(e) => setF({ ...f, entry: e.target.value })} />
            <input className={inputCls} placeholder="Stop" value={f.stop}
              onChange={(e) => setF({ ...f, stop: e.target.value })} />
            <input className={inputCls} placeholder="Target" value={f.target}
              onChange={(e) => setF({ ...f, target: e.target.value })} />
            <input className={inputCls} placeholder="Setup type" value={f.setupType}
              onChange={(e) => setF({ ...f, setupType: e.target.value })} />
            <input className={inputCls} placeholder="Confidence %" value={f.confidence}
              onChange={(e) => setF({ ...f, confidence: e.target.value })} />
          </div>
          <textarea className={`${inputCls} h-auto py-2 w-full resize-none`} rows={2}
            placeholder="Thesis* — why this trade" value={f.thesis}
            onChange={(e) => setF({ ...f, thesis: e.target.value })} />
          <button onClick={submit}
            className="w-full h-8 rounded-lg bg-emerald-500/[0.08] border border-emerald-500/15 text-[11px] font-medium text-emerald-400 hover:bg-emerald-500/[0.14] transition-all">
            Add to journal
          </button>
        </motion.div>
      )}

      {/* Analytics dashboard */}
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
        <Tile label="Win rate" value={`${a.winrate}%`} tone={a.closed ? (a.winrate >= 50 ? 'text-emerald-400' : 'text-red-400') : undefined} />
        <Tile label="Closed" value={`${a.closed}`} />
        <Tile label="Open" value={`${a.open}`} />
        <Tile label="Avg R:R" value={a.avgRR ? `${a.avgRR}` : '—'} />
        <Tile label="Expectancy" value={hasExpectancy ? `${a.expectancy >= 0 ? '+' : ''}${a.expectancy}` : '—'}
          tone={hasExpectancy ? (a.expectancy >= 0 ? 'text-emerald-400' : 'text-red-400') : undefined} />
      </div>

      {/* Win/loss + RR distribution */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div className="rounded-xl border border-white/[0.04] bg-white/[0.015] p-3">
          <p className="text-[10px] text-slate-600 mb-1.5">Win / loss</p>
          <div className="flex h-2 rounded-full overflow-hidden bg-white/[0.05]">
            <div className="bg-emerald-500/60" style={{ width: `${a.closed ? (a.wins / a.closed) * 100 : 0}%` }} />
            <div className="bg-slate-500/40" style={{ width: `${a.closed ? (a.breakeven / a.closed) * 100 : 0}%` }} />
            <div className="bg-red-500/60" style={{ width: `${a.closed ? (a.losses / a.closed) * 100 : 0}%` }} />
          </div>
          <div className="flex justify-between mt-1 text-[10px]">
            <span className="text-emerald-400">{a.wins}W</span>
            <span className="text-slate-500">{a.breakeven}BE</span>
            <span className="text-red-400">{a.losses}L</span>
          </div>
        </div>
        <div className="rounded-xl border border-white/[0.04] bg-white/[0.015] p-3">
          <p className="text-[10px] text-slate-600 mb-1.5">Planned R:R distribution</p>
          <div className="flex items-end gap-2 h-10">
            {a.rrBuckets.map((b) => {
              const max = Math.max(1, ...a.rrBuckets.map((x) => x.count));
              return (
                <div key={b.label} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full bg-cyan-500/30 rounded-sm" style={{ height: `${(b.count / max) * 100}%`, minHeight: b.count ? 4 : 0 }} />
                  <span className="text-[9px] text-slate-600">{b.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Setup breakdown */}
      {a.bySetup.length > 0 && (
        <div className="rounded-xl border border-white/[0.04] bg-white/[0.015] p-3">
          <p className="text-[10px] text-slate-600 mb-2">Setup breakdown</p>
          <div className="space-y-1">
            {a.bySetup.map((s) => (
              <div key={s.setup} className="flex items-center gap-2 text-[11px]">
                <span className="text-slate-300 flex-1 truncate capitalize">{s.setup}</span>
                <span className="text-slate-500">{s.trades} trades</span>
                <span className={s.winrate >= 50 ? 'text-emerald-400' : 'text-red-400'}>{s.winrate}%</span>
                <span className="text-slate-600 w-12 text-right">R:R {s.avgRR || '—'}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Insights (computed from real entries only) */}
      <div className={`rounded-xl border p-3 ${a.reliable ? 'border-indigo-500/10 bg-indigo-500/[0.03]' : 'border-white/[0.04] bg-white/[0.015]'}`}>
        <p className="text-[10px] text-slate-600 mb-1.5">Journal insights</p>
        <ul className="space-y-1 text-[11px] text-slate-400 leading-relaxed list-disc list-inside">
          {a.insights.map((t, i) => <li key={i}>{t}</li>)}
        </ul>
      </div>

      {/* Entries */}
      {entries.length === 0 ? (
        <p className="text-[11px] text-slate-600 text-center py-8">
          No trades logged yet. Use “Log trade” (or “Log to journal” from a signal) to start.
        </p>
      ) : (
        <div className="space-y-1.5">
          {entries.map((e) => {
            const isOpen = !e.result || e.result === 'open';
            const dirShort = e.direction === 'short';
            return (
              <div key={e.id} className="rounded-xl border border-white/[0.03] bg-white/[0.01] p-3 group">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[12px] font-semibold text-white">{e.symbol}</span>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${dirShort ? 'bg-red-500/[0.1] text-red-400' : 'bg-emerald-500/[0.1] text-emerald-400'}`}>
                    {dirShort ? <TrendingDown className="inline w-3 h-3" /> : <TrendingUp className="inline w-3 h-3" />} {e.direction || 'long'}
                  </span>
                  {e.setupType && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-white/[0.05] text-slate-400">{e.setupType}</span>}
                  {e.timeframe && <span className="text-[9px] text-slate-600">{e.timeframe}</span>}
                  <span className={`ml-auto text-[9px] px-1.5 py-0.5 rounded-full ${
                    isOpen ? 'bg-amber-500/[0.1] text-amber-400'
                    : e.result === 'win' ? 'bg-emerald-500/[0.1] text-emerald-400'
                    : e.result === 'loss' ? 'bg-red-500/[0.1] text-red-400'
                    : 'bg-slate-500/[0.1] text-slate-400'}`}>
                    {isOpen ? 'open' : e.result}
                  </span>
                  <button onClick={() => removeEntry(e.id)} aria-label="Delete"
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-700 hover:text-red-400">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex items-center gap-3 mt-1 text-[10px] text-slate-600">
                  <span>E {e.entry ?? '—'}</span>
                  <span>S {e.stop ?? '—'}</span>
                  <span>T {e.target ?? '—'}</span>
                  {typeof e.confidenceAtEntry === 'number' && <span>{e.confidenceAtEntry}% conf</span>}
                </div>
                <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">{e.thesis}</p>
                {isOpen ? (
                  <div className="flex items-center gap-1.5 mt-2">
                    <button onClick={() => closeEntry(e.id, 'win')}
                      className="px-2 py-1 rounded-md text-[10px] bg-emerald-500/[0.08] border border-emerald-500/15 text-emerald-400 hover:bg-emerald-500/[0.14]">Win</button>
                    <button onClick={() => closeEntry(e.id, 'loss')}
                      className="px-2 py-1 rounded-md text-[10px] bg-red-500/[0.08] border border-red-500/15 text-red-400 hover:bg-red-500/[0.14]">Loss</button>
                    <button onClick={() => closeEntry(e.id, 'breakeven')}
                      className="px-2 py-1 rounded-md text-[10px] bg-slate-500/[0.08] border border-slate-500/15 text-slate-400 hover:bg-slate-500/[0.14]">Breakeven</button>
                  </div>
                ) : (
                  <input
                    className={`${inputCls} mt-2 w-full`}
                    placeholder="Mistake / review notes"
                    defaultValue={e.mistakeNotes || ''}
                    onBlur={(ev) => updateEntry(e.id, { mistakeNotes: ev.target.value.trim() || null })}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
