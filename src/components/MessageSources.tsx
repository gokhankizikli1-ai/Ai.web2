import { useState } from 'react';
import { ChevronDown, Globe } from 'lucide-react';
import type { MessageSource } from '@/types';

/** Safe domain from a url (never throws). */
function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url.replace(/^https?:\/\//i, '').split('/')[0] || url;
  }
}

/** Favicon with graceful fallback to an initial circle. Uses Google's
 * public favicon service (main app — not CSP-restricted); on any load
 * error we drop to the domain's first letter so a broken icon never
 * leaves an empty box. No fabricated icons. */
function Favicon({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  const domain = domainOf(url);
  if (failed) {
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#151C28] border border-[#253142] text-[9px] font-semibold text-[#94A3B8]">
        {domain.charAt(0).toUpperCase()}
      </span>
    );
  }
  return (
    <img
      src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`}
      alt=""
      width={20}
      height={20}
      loading="lazy"
      onError={() => setFailed(true)}
      className="h-5 w-5 shrink-0 rounded-full bg-[#151C28] object-contain"
    />
  );
}

/**
 * Collapsed "Show sources · N" control that lives UNDER the assistant
 * bubble (never inline in the answer). Expands into a compact list of the
 * real web sources the answer used — favicon, site/domain, page title if
 * present, and a quiet "Used" tag. Sources come from message metadata
 * (backend `urls`); this component never invents entries.
 */
export default function MessageSources({
  sources,
  showLabel,
  usedLabel,
}: {
  sources: MessageSource[];
  showLabel: string;
  usedLabel: string;
}) {
  const [open, setOpen] = useState(false);
  if (!sources.length) return null;

  return (
    <div className="mt-1.5">
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] text-[#94A3B8] hover:text-[#CBD5E1] border border-[#253142] bg-white/[0.01] hover:bg-white/[0.03] transition-colors"
      >
        <Globe className="h-3 w-3" />
        {showLabel} · {sources.length}
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="mt-1.5 flex flex-col gap-0.5 rounded-xl border border-[#253142] bg-[#0D1117] p-1.5">
          {sources.map((s) => {
            const domain = domainOf(s.url);
            return (
              <a
                key={s.url}
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group/src flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-white/[0.03] transition-colors"
              >
                <Favicon url={s.url} />
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] text-[#CBD5E1] group-hover/src:text-[#F8FAFC] truncate transition-colors">
                    {s.title || domain}
                  </div>
                  <div className="text-[10px] text-[#64748B] truncate">{domain}</div>
                </div>
                <span className="shrink-0 text-[9.5px] text-[#64748B] uppercase tracking-wide">{usedLabel}</span>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
