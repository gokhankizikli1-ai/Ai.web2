import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { X, Search, Loader2, ImageOff, AlertTriangle, Check, ExternalLink } from 'lucide-react';
import { useLanguageStore } from '@/stores/languageStore';
import {
  searchStockImages, type StockImageResult, type StockProviderFilter, type StockImageSearchResponse,
} from '@/lib/stockImages';

/**
 * StockImagePicker (Phase 14K.2) — a real stock-photo search dialog powered by
 * the backend Pexels + Unsplash proxy. It searches ONLY on Enter / the Search
 * button (never per keystroke), shows honest loading / empty / error / partial
 * states, and every result carries the required provider attribution + link.
 *
 * Selecting a photo previews it live in the current preview via `onPreview`
 * (temporary, no persistence). Apply confirms; Cancel / Escape / backdrop closes
 * and the caller restores the original. Focus is trapped lightly and returned to
 * the trigger on close. All copy is localized via t().
 */

interface Props {
  open: boolean;
  /** A short suggested query derived from the selected element (prefilled). */
  initialQuery?: string;
  /** Fired when a grid result is chosen — the caller previews it live. Null clears. */
  onPreview: (result: StockImageResult | null) => void;
  /** Apply the currently-selected photo to the live preview (keeps it). */
  onApply: (result: StockImageResult) => void;
  /** Cancel / dismiss — the caller restores the original image. */
  onClose: () => void;
}

const PER_PAGE = 24;

export default function StockImagePicker({ open, initialQuery, onPreview, onApply, onClose }: Props) {
  const { t } = useLanguageStore();
  const [query, setQuery] = useState('');
  const [provider, setProvider] = useState<StockProviderFilter>('all');
  const [results, setResults] = useState<StockImageResult[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  const selected = results.find((r) => r.id === selectedId) || null;

  const runSearch = useCallback(async (q: string, prov: StockProviderFilter, nextPage: number) => {
    const term = q.trim();
    if (!term) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const append = nextPage > 1;
    if (append) setLoadingMore(true); else { setLoading(true); setResults([]); setSelectedId(null); }
    setError(null);
    setNotice(null);
    try {
      const data: StockImageSearchResponse = await searchStockImages({
        q: term, provider: prov, page: nextPage, perPage: PER_PAGE, signal: ctrl.signal,
      });
      if (ctrl.signal.aborted) return;
      if (data.error === 'no_providers_configured') {
        setResults([]); setHasMore(false); setError('not_configured'); setSearched(true);
        return;
      }
      const rows = Array.isArray(data.results) ? data.results : [];
      setResults((prev) => (append ? [...prev, ...rows] : rows));
      setHasMore(!!data.hasMore);
      setPage(nextPage);
      setSearched(true);
      // Honest partial-failure signal: one provider errored while the other worked.
      const anyError = data.providers?.pexels === 'error' || data.providers?.unsplash === 'error';
      if (anyError && rows.length > 0) setNotice(t('stockSomeUnavailable'));
    } catch (e) {
      if (ctrl.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) return;
      setError('load_failed');
      setSearched(true);
    } finally {
      if (!ctrl.signal.aborted) { setLoading(false); setLoadingMore(false); }
    }
  }, [t]);

  // On open: reset, prefill the suggested query, focus, and auto-run the first
  // search if we have a suggestion. Store the trigger to return focus on close.
  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = (document.activeElement as HTMLElement) || null;
    const q = (initialQuery || '').trim().slice(0, 120);
    setQuery(q);
    setProvider('all');
    setResults([]);
    setSelectedId(null);
    setError(null);
    setNotice(null);
    setSearched(false);
    setHasMore(false);
    setPage(1);
    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 30);
    if (q) runSearch(q, 'all', 1);
    return () => window.clearTimeout(focusTimer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Escape closes; abort any in-flight search and return focus to the trigger.
  const close = useCallback(() => {
    abortRef.current?.abort();
    onClose();
    const el = restoreFocusRef.current;
    if (el && typeof el.focus === 'function') window.setTimeout(() => el.focus(), 0);
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, close]);

  useEffect(() => () => { abortRef.current?.abort(); }, []);

  if (!open) return null;

  const pickProvider = (p: StockProviderFilter) => {
    setProvider(p);
    if (query.trim()) runSearch(query, p, 1);
  };

  const choose = (r: StockImageResult) => {
    setSelectedId(r.id);
    onPreview(r);
  };

  const viewOnLabel = (p: StockImageResult['provider']) =>
    p === 'unsplash' ? t('stockViewOnUnsplash') : t('stockViewOnPexels');

  const providerTabs: { key: StockProviderFilter; label: string }[] = [
    { key: 'all', label: t('stockAllSources') },
    { key: 'pexels', label: t('stockProviderPexels') },
    { key: 'unsplash', label: t('stockProviderUnsplash') },
  ];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[95] flex items-center justify-center bg-black/70 p-4 backdrop-blur-md"
      onClick={close}
    >
      <motion.div
        ref={dialogRef}
        initial={{ opacity: 0, scale: 0.97, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 8 }}
        transition={{ duration: 0.18 }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t('stockTitle')}
        className="flex max-h-[86vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-[#3B82F6]/20 bg-[#0b0b12]/97 shadow-2xl shadow-[#3B82F6]/5"
      >
        {/* Header + search */}
        <div className="border-b border-white/[0.06] px-5 py-3.5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-[#3B82F6]/20 bg-[#3B82F6]/[0.1]">
                <Search className="h-3.5 w-3.5 text-[#60A5FA]" />
              </div>
              <div className="text-[13px] font-semibold tracking-tight text-white">{t('stockTitle')}</div>
            </div>
            <button
              type="button"
              onClick={close}
              aria-label={t('stockClose')}
              className="grid h-7 w-7 place-items-center rounded-md text-[#94A3B8] transition-colors hover:bg-white/[0.05] hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <form
            onSubmit={(e) => { e.preventDefault(); if (query.trim()) runSearch(query, provider, 1); }}
            className="flex items-center gap-2"
          >
            <label htmlFor="stock-search-input" className="sr-only">{t('stockSearchLabel')}</label>
            <div className="relative flex-1">
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#64748B]" />
              <input
                ref={inputRef}
                id="stock-search-input"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('stockSearchPlaceholder')}
                maxLength={120}
                autoComplete="off"
                className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] py-2 pl-9 pr-3 text-[12.5px] text-slate-200 transition-all placeholder:text-[#5B6673] focus:border-[#3B82F6]/40 focus:bg-white/[0.05] focus:outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={!query.trim() || loading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#3B82F6]/30 bg-[#3B82F6]/[0.12] px-3.5 py-2 text-[12px] font-medium text-[#93C5FD] transition-colors hover:bg-[#3B82F6]/[0.18] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
              {t('stockSearchAction')}
            </button>
          </form>

          {/* Provider filter */}
          <div className="mt-3 inline-flex rounded-lg border border-white/[0.08] bg-white/[0.02] p-0.5 text-[11px]">
            {providerTabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => pickProvider(tab.key)}
                aria-pressed={provider === tab.key}
                className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                  provider === tab.key ? 'bg-[#3B82F6]/20 text-[#BFDBFE]' : 'text-[#94A3B8] hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Results */}
        <div className="min-h-[220px] flex-1 overflow-y-auto scrollbar-thin px-5 py-4">
          {loading && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {Array.from({ length: 9 }).map((_, i) => (
                <div key={i} className="aspect-[4/3] animate-pulse rounded-lg border border-white/[0.05] bg-white/[0.03]" />
              ))}
            </div>
          )}

          {!loading && error === 'not_configured' && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <ImageOff className="mb-2 h-7 w-7 text-[#64748B]" />
              <p className="text-[12.5px] font-medium text-[#CBD5E1]">{t('stockNotConfigured')}</p>
            </div>
          )}

          {!loading && error === 'load_failed' && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <AlertTriangle className="mb-2 h-7 w-7 text-[#FBBF24]" />
              <p className="text-[12.5px] font-medium text-[#FCD9A6]">{t('stockLoadError')}</p>
              <button
                type="button"
                onClick={() => query.trim() && runSearch(query, provider, 1)}
                className="mt-3 rounded-md border border-white/[0.1] bg-white/[0.03] px-3 py-1.5 text-[11px] text-[#CBD5E1] transition-colors hover:bg-white/[0.06]"
              >
                {t('stockRetry')}
              </button>
            </div>
          )}

          {!loading && !error && searched && results.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <ImageOff className="mb-2 h-7 w-7 text-[#64748B]" />
              <p className="text-[12.5px] font-medium text-[#CBD5E1]">{t('stockNoResults')}</p>
              <p className="mt-1 text-[11px] text-[#7C8C9B]">{t('stockTryAnother')}</p>
            </div>
          )}

          {!loading && !error && !searched && results.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Search className="mb-2 h-7 w-7 text-[#4B5563]" />
              <p className="text-[12.5px] text-[#8FA6BA]">{t('stockStartHint')}</p>
            </div>
          )}

          {results.length > 0 && (
            <>
              {notice && (
                <p className="mb-3 flex items-center gap-1.5 text-[11px] text-[#FBBF24]">
                  <AlertTriangle className="h-3 w-3" /> {notice}
                </p>
              )}
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {results.map((r) => {
                  const isSel = r.id === selectedId;
                  return (
                    <li key={r.id}>
                      <div className="group relative overflow-hidden rounded-lg border border-white/[0.06] bg-white/[0.02]">
                        <button
                          type="button"
                          onClick={() => choose(r)}
                          aria-pressed={isSel}
                          aria-label={r.alt || r.attributionText}
                          className={`block w-full ${isSel ? 'ring-2 ring-[#3B82F6]' : ''}`}
                        >
                          <span className="block aspect-[4/3] w-full overflow-hidden bg-white/[0.03]">
                            <img
                              src={r.thumbnailUrl}
                              alt={r.alt || ''}
                              loading="lazy"
                              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                            />
                          </span>
                          <span className="pointer-events-none absolute left-1.5 top-1.5 rounded-md bg-black/55 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-white/85 backdrop-blur-sm">
                            {r.provider === 'unsplash' ? t('stockProviderUnsplash') : t('stockProviderPexels')}
                          </span>
                          {isSel && (
                            <span className="pointer-events-none absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-[#3B82F6] text-white shadow">
                              <Check className="h-3 w-3" />
                            </span>
                          )}
                        </button>
                        <div className="flex items-center justify-between gap-1 px-2 py-1.5">
                          <span className="truncate text-[10px] text-[#8FA6BA]">
                            {t('stockPhotoBy')} {r.photographerName}
                          </span>
                          <a
                            href={r.providerPageUrl}
                            target="_blank"
                            rel="noopener noreferrer nofollow"
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex shrink-0 items-center gap-0.5 text-[9.5px] text-[#64748B] transition-colors hover:text-[#93C5FD]"
                            title={viewOnLabel(r.provider)}
                          >
                            {viewOnLabel(r.provider)} <ExternalLink className="h-2.5 w-2.5" />
                          </a>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>

              {hasMore && (
                <div className="mt-4 flex justify-center">
                  <button
                    type="button"
                    onClick={() => runSearch(query, provider, page + 1)}
                    disabled={loadingMore}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.1] bg-white/[0.03] px-4 py-2 text-[11.5px] text-[#CBD5E1] transition-colors hover:bg-white/[0.06] disabled:opacity-40"
                  >
                    {loadingMore && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    {t('stockLoadMore')}
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer — selected attribution + actions */}
        <div className="flex items-center justify-between gap-3 border-t border-white/[0.06] px-5 py-3">
          <p className="min-w-0 truncate text-[11px] text-[#7C8C9B]">
            {selected ? `${t('stockPhotoBy')} ${selected.photographerName} · ${selected.provider === 'unsplash' ? t('stockProviderUnsplash') : t('stockProviderPexels')}` : ''}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={close}
              className="rounded-md px-3 py-1.5 text-[11.5px] text-[#CBD5E1] transition-colors hover:bg-white/[0.05] hover:text-white"
            >
              {t('stockCancel')}
            </button>
            <button
              type="button"
              onClick={() => selected && onApply(selected)}
              disabled={!selected}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#3B82F6]/30 bg-[#3B82F6]/[0.14] px-3.5 py-1.5 text-[11.5px] font-medium text-[#93C5FD] transition-colors hover:bg-[#3B82F6]/[0.2] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Check className="h-3.5 w-3.5" /> {t('stockApplyImage')}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
