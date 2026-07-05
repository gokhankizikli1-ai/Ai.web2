import { type ReactElement } from 'react';
import { motion } from 'framer-motion';
import type { VisualModule } from '@/lib/webBuildLayoutPlan';

/**
 * Reusable STRUCTURAL visual modules for Web Build.
 *
 * These are not decorative panels or blank rectangles — each renders a real,
 * legible metaphor (a live dashboard, an access pass, a catalog index, a
 * floorplan, a product on a pedestal, a framed editorial image, a reservation
 * form, a process timeline, a before/after comparison, a topographic terrain).
 * The layout plan picks ONE as the primary module; hero compositions and key
 * sections embed it, so the visual language changes with the strategy.
 *
 * Colors come from the preview root CSS vars (--acc / --acc2), so a module reads
 * correctly against any strategy palette.
 */
export interface VisualModuleProps {
  kind: VisualModule;
  labels?: string[];
  className?: string;
  /** Compact variant for tight hero columns / section insets. */
  compact?: boolean;
}

const Frame = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => (
  <div className={`relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] ${className}`}>{children}</div>
);

const take = (labels: string[] | undefined, n: number, fallback: string[]): string[] => {
  const src = (labels && labels.filter(Boolean).length ? labels.filter(Boolean) : fallback);
  return Array.from({ length: n }, (_, i) => src[i % src.length]);
};

function DataDashboard({ labels, compact }: { labels?: string[]; compact?: boolean }) {
  const bars = [58, 82, 46, 94, 70, 88];
  const tiles = take(labels, 3, ['Aktif', 'Dönüşüm', 'Büyüme']);
  const stats = ['2.4k', '98%', '+37%'];
  return (
    <Frame className="p-4 shadow-2xl shadow-black/40">
      <div className="mb-3 flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full bg-white/20" /><span className="h-2.5 w-2.5 rounded-full bg-white/20" /><span className="h-2.5 w-2.5 rounded-full bg-white/20" />
        <span className="ml-auto h-2 w-16 rounded-full bg-white/10" />
      </div>
      <div className={`grid gap-3 ${compact ? '' : 'sm:grid-cols-3'}`}>
        {tiles.map((tl, i) => (
          <div key={i} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <div className="text-lg font-semibold text-white">{stats[i]}</div>
            <div className="mt-0.5 truncate text-[11px] text-slate-400">{tl}</div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex h-24 items-end gap-2 rounded-xl border border-white/10 bg-black/20 p-3">
        {bars.map((h, i) => (
          <motion.span
            key={i} className="flex-1 rounded-t"
            style={{ background: i % 2 ? 'var(--acc2)' : 'var(--acc)', opacity: 0.9 }}
            initial={{ height: 0 }} whileInView={{ height: `${h}%` }} viewport={{ once: true }}
            transition={{ duration: 0.7, delay: i * 0.06, ease: [0.22, 1, 0.36, 1] }}
          />
        ))}
      </div>
      <svg aria-hidden viewBox="0 0 300 60" className="mt-3 h-10 w-full" preserveAspectRatio="none">
        <polyline points="0,48 50,30 100,38 150,16 200,26 250,8 300,18" fill="none" stroke="var(--acc)" strokeWidth="2" />
      </svg>
    </Frame>
  );
}

function MembershipPass({ labels }: { labels?: string[] }) {
  const tier = (labels && labels[0]) || 'Membership';
  const holder = (labels && labels[1]) || 'Access · 2026';
  return (
    <Frame className="p-5">
      <div className="rounded-2xl border border-white/10 p-5" style={{ background: 'linear-gradient(135deg, color-mix(in srgb, var(--acc) 24%, transparent), color-mix(in srgb, var(--acc2) 12%, transparent))' }}>
        <div className="flex items-start justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-widest text-white/70">Member</div>
            <div className="mt-1 text-lg font-semibold text-white">{tier}</div>
          </div>
          <span className="h-9 w-9 rounded-lg border border-white/20 bg-white/10" />
        </div>
        <div className="mt-8 flex items-end justify-between">
          <span className="text-xs text-white/80">{holder}</span>
          <div className="flex h-8 items-end gap-[3px]">
            {[3, 6, 2, 7, 4, 6, 2, 5, 3, 7, 2, 6].map((h, i) => <span key={i} className="w-[3px] bg-white/80" style={{ height: `${h * 3}px` }} />)}
          </div>
        </div>
      </div>
    </Frame>
  );
}

function CatalogArchive({ labels, compact }: { labels?: string[]; compact?: boolean }) {
  const tiles = take(labels, compact ? 4 : 6, ['Koleksiyon', 'Arşiv', 'Seri', 'Edisyon', 'Parça', 'İndeks']);
  return (
    <Frame className="p-4">
      <div className={`grid gap-2.5 ${compact ? 'grid-cols-2' : 'grid-cols-3'}`}>
        {tiles.map((tl, i) => (
          <figure key={i} className="group relative overflow-hidden rounded-lg border border-white/10">
            <div className="aspect-square w-full transition duration-500 group-hover:scale-[1.05]" style={{ background: i % 3 === 0 ? 'linear-gradient(135deg, color-mix(in srgb, var(--acc) 26%, transparent), transparent)' : 'linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.01))' }} />
            <figcaption className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-2 py-1 text-[10px] font-medium text-white">{tl}</figcaption>
          </figure>
        ))}
      </div>
    </Frame>
  );
}

function SpatialFloorplan() {
  return (
    <Frame className="p-4">
      <svg aria-hidden viewBox="0 0 320 220" className="h-full w-full" style={{ minHeight: 200 }}>
        <rect x="8" y="8" width="304" height="204" rx="8" fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth="2" />
        <line x1="150" y1="8" x2="150" y2="130" stroke="rgba(255,255,255,0.16)" strokeWidth="2" />
        <line x1="8" y1="130" x2="312" y2="130" stroke="rgba(255,255,255,0.16)" strokeWidth="2" />
        <line x1="220" y1="130" x2="220" y2="212" stroke="rgba(255,255,255,0.16)" strokeWidth="2" />
        <rect x="26" y="150" width="60" height="40" rx="4" fill="color-mix(in srgb, var(--acc) 22%, transparent)" stroke="var(--acc)" />
        <circle cx="220" cy="66" r="26" fill="none" stroke="var(--acc2)" strokeWidth="2" />
        <rect x="40" y="30" width="70" height="8" rx="4" fill="rgba(255,255,255,0.14)" />
        <text x="60" y="176" fill="var(--acc)" fontSize="11" fontFamily="var(--hf)">A</text>
        <text x="232" y="70" fill="var(--acc2)" fontSize="11" fontFamily="var(--hf)">B</text>
      </svg>
    </Frame>
  );
}

function ProductShowcase() {
  return (
    <Frame className="flex items-center justify-center p-8">
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-6 h-40 w-40 -translate-x-1/2 rounded-full" style={{ background: 'radial-gradient(circle, color-mix(in srgb, var(--acc) 40%, transparent), transparent 70%)', filter: 'blur(30px)' }} />
      <motion.div animate={{ y: [0, -12, 0] }} transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }} className="relative">
        <div className="h-40 w-40 rounded-3xl border border-white/15 shadow-2xl shadow-black/50" style={{ background: 'linear-gradient(150deg, color-mix(in srgb, var(--acc) 40%, #0b0d12), color-mix(in srgb, var(--acc2) 24%, #0b0d12))' }} />
        <div className="mx-auto mt-4 h-2 w-32 rounded-full bg-black/40 blur-[2px]" />
      </motion.div>
    </Frame>
  );
}

function EditorialStory({ labels }: { labels?: string[] }) {
  const caption = (labels && labels[0]) || '';
  return (
    <Frame className="p-3">
      <div className="relative aspect-[4/5] w-full overflow-hidden rounded-xl" style={{ background: 'linear-gradient(135deg, color-mix(in srgb, var(--acc) 22%, transparent), color-mix(in srgb, var(--acc2) 12%, transparent))' }}>
        <svg aria-hidden viewBox="0 0 200 250" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" style={{ opacity: 0.5 }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <path key={i} d={`M0 ${40 + i * 34} C 60 ${10 + i * 34}, 150 ${80 + i * 34}, 200 ${40 + i * 34}`} fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth="1" />
          ))}
        </svg>
        <span className="absolute left-3 top-3 rounded-full bg-black/40 px-2 py-0.5 text-[10px] tracking-widest text-white/80">EDITORIAL</span>
      </div>
      {caption && <p className="mt-3 px-1 text-[13px] leading-snug text-slate-300">{caption}</p>}
    </Frame>
  );
}

function ReservationForm({ labels }: { labels?: string[] }) {
  const cta = (labels && labels[0]) || 'Rezervasyon';
  return (
    <Frame className="p-5">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="mb-1 text-[11px] text-slate-400">Tarih</div>
          <div className="grid grid-cols-4 gap-1">
            {Array.from({ length: 8 }).map((_, i) => <span key={i} className={`flex h-7 items-center justify-center rounded text-[11px] ${i === 3 ? 'text-white' : 'text-slate-400'}`} style={i === 3 ? { background: 'var(--acc)' } : { background: 'rgba(255,255,255,0.04)' }}>{i + 12}</span>)}
          </div>
        </div>
        <div>
          <div className="mb-1 text-[11px] text-slate-400">Kişi</div>
          <div className="flex gap-1">{['2', '4', '6'].map((n, i) => <span key={i} className={`flex h-7 flex-1 items-center justify-center rounded text-[11px] ${i === 0 ? 'text-white' : 'text-slate-400'}`} style={i === 0 ? { background: 'var(--acc2)' } : { background: 'rgba(255,255,255,0.04)' }}>{n}</span>)}</div>
          <div className="mb-1 mt-3 text-[11px] text-slate-400">Saat</div>
          <div className="flex gap-1">{['19:00', '20:30'].map((n, i) => <span key={i} className="flex h-7 flex-1 items-center justify-center rounded bg-white/[0.04] text-[11px] text-slate-300">{n}</span>)}</div>
        </div>
      </div>
      <div className="mt-4 flex h-10 items-center justify-center rounded-lg text-sm font-semibold text-white" style={{ background: 'var(--acc)' }}>{cta}</div>
    </Frame>
  );
}

function TimelineProcess({ labels }: { labels?: string[] }) {
  const steps = take(labels, 4, ['Keşif', 'Tasarım', 'Uygulama', 'Teslim']);
  return (
    <Frame className="p-5">
      <ol className="relative space-y-4 pl-6">
        <span aria-hidden className="absolute left-[9px] top-1 h-[calc(100%-0.5rem)] w-px bg-white/12" />
        {steps.map((st, i) => (
          <li key={i} className="relative">
            <span className="absolute -left-6 top-0.5 flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-black" style={{ background: 'var(--acc)' }}>{i + 1}</span>
            <p className="text-[13px] font-medium text-white">{st}</p>
          </li>
        ))}
      </ol>
    </Frame>
  );
}

function Comparison() {
  return (
    <Frame className="grid grid-cols-2">
      <div className="relative border-r border-white/10">
        <span className="absolute left-2 top-2 z-10 rounded-full bg-black/50 px-2 py-0.5 text-[10px] text-slate-300">Önce</span>
        <div className="aspect-[3/4]" style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.01))' }} />
      </div>
      <div className="relative">
        <span className="absolute left-2 top-2 z-10 rounded-full px-2 py-0.5 text-[10px] text-white" style={{ background: 'var(--acc)' }}>Sonra</span>
        <div className="aspect-[3/4]" style={{ background: 'linear-gradient(135deg, color-mix(in srgb, var(--acc) 26%, transparent), color-mix(in srgb, var(--acc2) 14%, transparent))' }} />
      </div>
    </Frame>
  );
}

function ContourTerrain() {
  return (
    <Frame className="p-0">
      <div className="aspect-[4/3] w-full" style={{ background: 'linear-gradient(135deg, color-mix(in srgb, var(--acc) 20%, transparent), color-mix(in srgb, var(--acc2) 10%, transparent))' }}>
        <svg aria-hidden viewBox="0 0 400 300" preserveAspectRatio="none" className="h-full w-full" style={{ opacity: 0.55 }}>
          {Array.from({ length: 8 }).map((_, i) => (
            <path key={i} d={`M0 ${34 + i * 32} C 110 ${6 + i * 32}, 290 ${86 + i * 32}, 400 ${40 + i * 32}`} fill="none" stroke={i % 3 === 0 ? 'var(--acc)' : 'rgba(255,255,255,0.14)'} strokeWidth="1" />
          ))}
        </svg>
      </div>
    </Frame>
  );
}

const MODULES: Record<VisualModule, (p: { labels?: string[]; compact?: boolean }) => ReactElement> = {
  'data-dashboard': (p) => <DataDashboard {...p} />,
  'membership-pass': (p) => <MembershipPass labels={p.labels} />,
  'catalog-archive': (p) => <CatalogArchive {...p} />,
  'spatial-floorplan': () => <SpatialFloorplan />,
  'product-showcase': () => <ProductShowcase />,
  'editorial-story': (p) => <EditorialStory labels={p.labels} />,
  'reservation-form': (p) => <ReservationForm labels={p.labels} />,
  'timeline-process': (p) => <TimelineProcess labels={p.labels} />,
  comparison: () => <Comparison />,
  'contour-terrain': () => <ContourTerrain />,
};

export default function VisualModule({ kind, labels, className = '', compact = false }: VisualModuleProps) {
  const Render = MODULES[kind] || MODULES['contour-terrain'];
  return <div className={className}>{Render({ labels, compact })}</div>;
}
