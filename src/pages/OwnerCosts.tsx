/**
 * OwnerCosts — in-app owner-only Web Build cost analytics.
 *
 * Fetches the owner-gated backend cost endpoints via the authenticated cost
 * client (Bearer + owner token/email headers) so the owner never has to open
 * the raw Railway dashboard URL (which carries no Korvix session). Access is
 * enforced SERVER-SIDE (401/403); this page only renders what the backend
 * returns and shows a neutral forbidden state on 401/403.
 *
 * Route is wrapped in <ProtectedRoute><OwnerRoute> in App.tsx, so non-owners
 * are already bounced; the in-page forbidden state is a defensive backstop.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useLanguageStore } from '@/stores/languageStore';
import {
  getCostAnalytics, listCostBuilds, getCostBuild,
  formatUsd, formatTokens, shortBuildId, CostApiError,
  type CostAnalytics, type CostBuildSummary, type CostBuildDetail,
} from '@/lib/costApi';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '@/components/ui/table';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';

type StatusFilter = 'all' | 'completed' | 'failed' | 'in_progress';

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    // Show the UTC instant explicitly — build windows are UTC server-side.
    return d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
  } catch { return '—'; }
}

function fmtDuration(seconds: number | null | undefined): string {
  const s = Number(seconds || 0);
  if (s <= 0) return '—';
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s - m * 60)}s`;
}

function truthy(v: boolean | number | null | undefined): boolean {
  return v === true || v === 1;
}

export default function OwnerCosts() {
  const { t } = useLanguageStore();
  const [analytics, setAnalytics] = useState<CostAnalytics | null>(null);
  const [builds, setBuilds] = useState<CostBuildSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // filters
  const [status, setStatus] = useState<StatusFilter>('all');
  const [failedOnly, setFailedOnly] = useState(false);
  const [search, setSearch] = useState('');

  // detail drawer
  const [detail, setDetail] = useState<CostBuildDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const [a, b] = await Promise.all([getCostAnalytics(), listCostBuilds(200)]);
      setAnalytics(a);
      setBuilds(b.builds || []);
    } catch (e) {
      if (e instanceof CostApiError && (e.status === 401 || e.status === 403)) {
        setForbidden(true);
      } else {
        setError(e instanceof Error ? e.message : 'error');
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  async function openBuild(id: string) {
    setDetailOpen(true);
    setDetail(null);
    setDetailLoading(true);
    try {
      setDetail(await getCostBuild(id));
    } catch {
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return builds.filter((bd) => {
      if (status !== 'all' && (bd.status || '') !== status) return false;
      if (failedOnly && !(bd.failed_calls > 0)) return false;
      if (q && !(bd.build_id || '').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [builds, status, failedOnly, search]);

  const derived = useMemo(() => {
    let completed = 0, failed = 0, totalCalls = 0, totalFailed = 0;
    for (const bd of builds) {
      if (bd.status === 'completed') completed++;
      if (bd.status === 'failed' || bd.failed_calls > 0) failed++;
      totalCalls += bd.total_ai_calls || 0;
      totalFailed += bd.failed_calls || 0;
    }
    return { completed, failed, totalCalls, totalFailed };
  }, [builds]);

  /* ── Forbidden / loading shells ─────────────────────────────────────────── */
  if (forbidden) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0B0D12] text-slate-300">
        <Card className="p-8 max-w-sm text-center bg-[#151922] border-white/[0.06]">
          <AlertTriangle className="h-8 w-8 mx-auto mb-3 text-amber-400/80" />
          <div className="text-[15px] font-medium text-slate-100">{t('costForbiddenTitle')}</div>
          <div className="mt-1 text-[13px] text-slate-400">{t('costForbiddenBody')}</div>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0B0D12] text-slate-200 px-4 sm:px-6 py-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 mb-1">
          <div>
            <h1 className="text-[18px] font-semibold text-slate-100">{t('costTitle')}</h1>
            <p className="text-[12.5px] text-slate-400 mt-0.5">{t('costSubtitle')}</p>
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}
                  className="gap-1.5 border-white/[0.1] bg-white/[0.03] text-slate-200">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            {t('costRefresh')}
          </Button>
        </div>

        {error && (
          <div className="mt-3 rounded-lg border border-red-500/20 bg-red-500/[0.06] px-3 py-2 text-[12.5px] text-red-300">
            {t('costLoadError')}
          </div>
        )}

        {/* Overview cards */}
        <section className="mt-5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
          {loading && !analytics ? (
            Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-[68px] rounded-xl bg-white/[0.04]" />
            ))
          ) : analytics ? (
            <>
              <MetricCard label={t('costTotalBuilds')} value={formatTokens(analytics.build_count)} />
              <MetricCard label={t('costCompletedBuilds')} value={formatTokens(derived.completed)} />
              <MetricCard label={t('costFailedBuilds')} value={formatTokens(derived.failed)}
                          tone={derived.failed > 0 ? 'warn' : undefined} />
              <MetricCard label={t('costTotalUsd')} value={formatUsd(analytics.total_cost_usd)} accent />
              <MetricCard label={t('costAvg')} value={formatUsd(analytics.average_build_cost_usd)} />
              <MetricCard label={t('costMedian')} value={formatUsd(analytics.median_build_cost_usd)} />
              <MetricCard label={t('costP90')} value={formatUsd(analytics.p90_build_cost_usd)} />
              <MetricCard label={t('costP95')} value={formatUsd(analytics.p95_build_cost_usd)} />
              <MetricCard label={t('costTotalCalls')} value={formatTokens(derived.totalCalls)} />
              <MetricCard label={t('costFailedCalls')} value={formatTokens(derived.totalFailed)}
                          tone={derived.totalFailed > 0 ? 'warn' : undefined} />
              <MetricCard label={t('costRetryCost')} value={formatUsd(analytics.retry_costs?.retry_cost_usd)} />
              <MetricCard
                label={t('costCheapest')}
                value={analytics.cheapest_build ? formatUsd(analytics.cheapest_build.total_build_cost_usd) : '—'}
                sub={analytics.cheapest_build ? shortBuildId(analytics.cheapest_build.build_id) : undefined} />
              <MetricCard
                label={t('costMostExpensive')}
                value={analytics.most_expensive_build ? formatUsd(analytics.most_expensive_build.total_build_cost_usd) : '—'}
                sub={analytics.most_expensive_build ? shortBuildId(analytics.most_expensive_build.build_id) : undefined} />
            </>
          ) : null}
        </section>

        {/* Filters */}
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('costSearchPlaceholder')}
            className="h-8 w-56 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 text-[12.5px] text-slate-100 placeholder:text-slate-500 outline-none focus:border-white/[0.16]"
          />
          {(['all', 'completed', 'failed', 'in_progress'] as StatusFilter[]).map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`h-8 rounded-lg px-2.5 text-[12px] border transition-colors ${
                status === s
                  ? 'border-white/[0.2] bg-white/[0.08] text-slate-100'
                  : 'border-white/[0.06] bg-white/[0.02] text-slate-400 hover:text-slate-200'
              }`}
            >
              {t(`costStatus_${s}`)}
            </button>
          ))}
          <label className="ml-1 flex items-center gap-1.5 text-[12px] text-slate-400 cursor-pointer select-none">
            <input type="checkbox" checked={failedOnly} onChange={(e) => setFailedOnly(e.target.checked)}
                   className="accent-amber-500" />
            {t('costFailedOnly')}
          </label>
          <span className="ml-auto text-[11.5px] text-slate-500">
            {t('costShowingCount', { shown: filtered.length, total: builds.length })}
          </span>
        </div>

        {/* Build table */}
        <div className="mt-2.5 rounded-xl border border-white/[0.06] overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-white/[0.06] hover:bg-transparent">
                <TableHead className="text-slate-400">{t('costColBuild')}</TableHead>
                <TableHead className="text-slate-400">{t('costColStarted')}</TableHead>
                <TableHead className="text-slate-400">{t('costColStatus')}</TableHead>
                <TableHead className="text-slate-400 text-right">{t('costColDuration')}</TableHead>
                <TableHead className="text-slate-400 text-right">{t('costColUsd')}</TableHead>
                <TableHead className="text-slate-400 text-right">{t('costColCalls')}</TableHead>
                <TableHead className="text-slate-400 text-right">{t('costColFailed')}</TableHead>
                <TableHead className="text-slate-400 text-right">{t('costColInput')}</TableHead>
                <TableHead className="text-slate-400 text-right">{t('costColCached')}</TableHead>
                <TableHead className="text-slate-400 text-right">{t('costColOutput')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && builds.length === 0 ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i} className="border-white/[0.04]">
                    <TableCell colSpan={10}><Skeleton className="h-4 w-full bg-white/[0.04]" /></TableCell>
                  </TableRow>
                ))
              ) : filtered.length === 0 ? (
                <TableRow className="border-white/[0.04] hover:bg-transparent">
                  <TableCell colSpan={10} className="text-center text-[12.5px] text-slate-500 py-8">
                    {t('costNoBuilds')}
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((bd) => (
                  <TableRow
                    key={bd.build_id}
                    onClick={() => openBuild(bd.build_id)}
                    className="border-white/[0.04] cursor-pointer hover:bg-white/[0.03]"
                  >
                    <TableCell className="font-mono text-[11.5px] text-slate-300" title={bd.build_id}>
                      {shortBuildId(bd.build_id)}
                    </TableCell>
                    <TableCell className="text-[11.5px] text-slate-400 whitespace-nowrap">{fmtTime(bd.started_at)}</TableCell>
                    <TableCell><StatusBadge status={bd.status} failed={bd.failed_calls} t={t} /></TableCell>
                    <TableCell className="text-right text-[12px] text-slate-400">{fmtDuration(bd.build_duration_seconds)}</TableCell>
                    <TableCell className="text-right text-[12px] font-medium text-slate-100">{formatUsd(bd.total_build_cost_usd)}</TableCell>
                    <TableCell className="text-right text-[12px] text-slate-300">{formatTokens(bd.total_ai_calls)}</TableCell>
                    <TableCell className={`text-right text-[12px] ${bd.failed_calls > 0 ? 'text-amber-400' : 'text-slate-500'}`}>
                      {formatTokens(bd.failed_calls)}
                    </TableCell>
                    <TableCell className="text-right text-[12px] text-slate-400">{formatTokens(bd.total_input_tokens)}</TableCell>
                    <TableCell className="text-right text-[12px] text-slate-400">{formatTokens(bd.total_cached_tokens)}</TableCell>
                    <TableCell className="text-right text-[12px] text-slate-400">{formatTokens(bd.total_output_tokens)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Detail drawer */}
      <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
        <SheetContent className="bg-[#0E1218] border-l border-white/[0.08] text-slate-200 w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader className="border-b border-white/[0.06] pb-3">
            <SheetTitle className="text-slate-100 text-[15px]">{t('costDetailTitle')}</SheetTitle>
          </SheetHeader>
          {detailLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-5 w-full bg-white/[0.04]" />)}
            </div>
          ) : detail ? (
            <BuildDetail detail={detail} t={t} />
          ) : (
            <div className="p-4 text-[12.5px] text-slate-500">{t('costDetailError')}</div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

/* ── Small presentational pieces ────────────────────────────────────────────── */
function MetricCard({ label, value, sub, accent, tone }: {
  label: string; value: string; sub?: string; accent?: boolean; tone?: 'warn';
}) {
  return (
    <Card className="p-3 bg-[#151922] border-white/[0.06] rounded-xl">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className={`mt-1 text-[17px] font-semibold tabular-nums ${
        tone === 'warn' ? 'text-amber-400' : accent ? 'text-emerald-300' : 'text-slate-100'
      }`}>{value}</div>
      {sub && <div className="mt-0.5 font-mono text-[10.5px] text-slate-500 truncate">{sub}</div>}
    </Card>
  );
}

function StatusBadge({ status, failed, t }: {
  status: string; failed: number; t: (k: string, p?: Record<string, string | number>) => string;
}) {
  if (failed > 0 && status !== 'failed') {
    return <Badge variant="outline" className="border-amber-500/30 bg-amber-500/[0.08] text-amber-300 text-[10.5px]">{t('costStatus_partial')}</Badge>;
  }
  const map: Record<string, string> = {
    completed: 'border-emerald-500/30 bg-emerald-500/[0.08] text-emerald-300',
    failed: 'border-red-500/30 bg-red-500/[0.08] text-red-300',
    in_progress: 'border-sky-500/30 bg-sky-500/[0.08] text-sky-300',
  };
  const cls = map[status] || 'border-white/[0.1] bg-white/[0.04] text-slate-400';
  return <Badge variant="outline" className={`${cls} text-[10.5px]`}>{t(`costStatus_${status}`) || status}</Badge>;
}

function BuildDetail({ detail, t }: {
  detail: CostBuildDetail; t: (k: string, p?: Record<string, string | number>) => string;
}) {
  const hasMissing = (detail.usage_missing_calls || 0) > 0;
  return (
    <div className="p-4 space-y-4">
      <div className="font-mono text-[11.5px] text-slate-400 break-all">{detail.build_id}</div>

      {/* summary grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[12px]">
        <KV k={t('costColStatus')} v={<StatusBadge status={detail.status} failed={detail.failed_calls} t={t} />} />
        <KV k={t('costDetailStarted')} v={fmtTime(detail.started_at)} />
        <KV k={t('costDetailCompleted')} v={fmtTime(detail.completed_at)} />
        <KV k={t('costColDuration')} v={fmtDuration(detail.build_duration_seconds)} />
        <KV k={t('costDetailTotalCost')} v={<span className="text-emerald-300 font-medium">{formatUsd(detail.total_build_cost_usd)}</span>} />
        <KV k={t('costDetailToolCost')} v={formatUsd(detail.total_tool_cost_usd)} />
        <KV k={t('costColInput')} v={formatTokens(detail.total_input_tokens)} />
        <KV k={t('costColCached')} v={formatTokens(detail.total_cached_tokens)} />
        <KV k={t('costColOutput')} v={formatTokens(detail.total_output_tokens)} />
        <KV k={t('costDetailReasoning')} v={formatTokens(detail.total_reasoning_tokens)} />
        <KV k={t('costColCalls')} v={formatTokens(detail.total_ai_calls)} />
        <KV k={t('costColFailed')} v={formatTokens(detail.failed_calls)} />
      </div>

      {hasMissing && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2 text-[11.5px] text-amber-200">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>{t('costUsageMissingWarn', { n: detail.usage_missing_calls })}</span>
        </div>
      )}

      {/* calls */}
      <div>
        <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1.5">{t('costDetailCalls')}</div>
        <div className="space-y-2">
          {(detail.calls || []).map((c, i) => {
            const ok = truthy(c.success);
            const missing = truthy(c.usage_missing);
            return (
              <div key={c.call_id || i} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] text-slate-500">#{i + 1}</span>
                  <span className="text-[12px] text-slate-200">{c.operation_type}</span>
                  <span className="text-[11px] text-slate-500">{c.provider}/{c.model || '—'}</span>
                  {c.retry_number > 0 && (
                    <Badge variant="outline" className="border-white/[0.1] bg-white/[0.04] text-slate-400 text-[10px]">
                      {t('costRetryN', { n: c.retry_number })}
                    </Badge>
                  )}
                  <Badge variant="outline" className={`text-[10px] ${
                    ok ? 'border-emerald-500/30 bg-emerald-500/[0.08] text-emerald-300'
                       : 'border-red-500/30 bg-red-500/[0.08] text-red-300'}`}>
                    {ok ? t('costOk') : t('costFail')}
                  </Badge>
                  {missing && (
                    <Badge variant="outline" className="border-amber-500/30 bg-amber-500/[0.08] text-amber-300 text-[10px]">
                      {t('costUsageMissing')}
                    </Badge>
                  )}
                  <span className="ml-auto text-[12px] font-medium text-slate-100">{formatUsd(c.total_call_cost_usd)}</span>
                </div>
                <div className="mt-1.5 grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-0.5 text-[11px] text-slate-400">
                  <span>{t('costColInput')}: {missing ? t('costMissingDash') : formatTokens(c.input_tokens)}</span>
                  <span>{t('costColOutput')}: {missing ? t('costMissingDash') : formatTokens(c.output_tokens)}</span>
                  <span>{t('costColCached')}: {missing ? t('costMissingDash') : formatTokens(c.cached_input_tokens)}</span>
                  <span>{t('costDetailReasoning')}: {missing ? t('costMissingDash') : formatTokens(c.reasoning_tokens)}</span>
                  {c.tool_key && <span>{t('costDetailTool')}: {c.tool_key}</span>}
                  {c.request_id && <span className="font-mono truncate">{t('costDetailReqId')}: {c.request_id}</span>}
                </div>
                {!ok && (c.error_kind || c.error_code || c.error_message) && (
                  <div className="mt-1.5 rounded border border-red-500/20 bg-red-500/[0.05] px-2 py-1.5 text-[11px] text-red-300">
                    <span className="font-medium">{c.error_kind || t('costError')}</span>
                    {c.error_code && <span className="text-red-400/80"> · {c.error_code}</span>}
                    {c.error_message && <div className="mt-0.5 text-red-300/80">{c.error_message}</div>}
                  </div>
                )}
              </div>
            );
          })}
          {(detail.calls || []).length === 0 && (
            <div className="text-[12px] text-slate-500">{t('costNoCalls')}</div>
          )}
        </div>
      </div>
    </div>
  );
}

function KV({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div>
      <div className="text-[10.5px] text-slate-500">{k}</div>
      <div className="text-slate-200">{v}</div>
    </div>
  );
}
