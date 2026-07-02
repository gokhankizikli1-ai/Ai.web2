import { useState, useEffect } from 'react';
import { Building2, Radar } from 'lucide-react';
import EcommerceCommandCenter from './EcommerceCommandCenter';
import StartupMarketRadar from './startup/StartupMarketRadar';

/* ═══════════════════════════════════════════
   TYPES
   ═══════════════════════════════════════════ */
type BusinessSubTab = 'startup' | 'ecommerce';

/* ═══════════════════════════════════════════
   LOCAL STORAGE
   ═══════════════════════════════════════════ */
const STORAGE_KEY = 'korvix_business_workspace';

/** Restore the last-used subtab. Legacy saved states may carry the
 * removed 'workspace' / 'autopilot' subtabs (and old planning-canvas
 * fields) — anything unknown migrates to 'startup'. */
function loadSubTab(): BusinessSubTab {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as { subTab?: string };
      if (saved.subTab === 'ecommerce') return 'ecommerce';
    }
  } catch { /* ignore */ }
  return 'startup';
}

function saveSubTab(subTab: BusinessSubTab) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ subTab }));
  } catch { /* ignore */ }
}

/* ═══════════════════════════════════════════
   MAIN COMPONENT — two real product surfaces:
   Startup (Market Complaint Radar) + E-commerce (command center).
   The old Workspace/Autopilot planning subtabs are removed.
   ═══════════════════════════════════════════ */
export default function BusinessPanel() {
  const [subTab, setSubTab] = useState<BusinessSubTab>(loadSubTab);

  useEffect(() => {
    saveSubTab(subTab);
  }, [subTab]);

  const SUB_TABS: { id: BusinessSubTab; label: string }[] = [
    { id: 'startup', label: 'Startup' },
    { id: 'ecommerce', label: 'E-commerce' },
  ];

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-4 pt-3 pb-1.5">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-amber-500/[0.06] border border-amber-500/10">
            <Building2 className="h-3 w-3 text-amber-400/70" />
          </div>
          <div>
            <h2 className="text-[13px] font-semibold text-white">Business Workspace</h2>
            <p className="text-[10px] text-slate-500">Startup market intelligence · e-commerce command center</p>
          </div>
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="shrink-0 flex items-center gap-1 px-4 pb-2">
        {SUB_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setSubTab(t.id)}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
              subTab === t.id
                ? 'bg-white/[0.06] text-white'
                : 'text-slate-600 hover:text-slate-400 hover:bg-white/[0.015]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto scrollbar-thin px-4 pb-4">
        {subTab === 'startup' && (
          <div>
            {/* Same live Market Complaint Radar as /tools/startup —
                embedded mode hands "Send to Startup Advisor" off via the
                in-app korvix-route-to-chat event instead of a navigation. */}
            <div className="flex items-center gap-2 mb-2.5">
              <Radar className="h-3.5 w-3.5 text-amber-400/70" />
              <div>
                <span className="text-[13px] font-medium text-white">Market Complaint Radar</span>
                <p className="text-[10px] text-slate-500">Find where the market is angry before you build — live public signals, honest source status.</p>
              </div>
            </div>
            <StartupMarketRadar embedded />
          </div>
        )}

        {subTab === 'ecommerce' && (
          <div className="h-full -mx-4 -mb-4">
            <EcommerceCommandCenter />
          </div>
        )}
      </div>
    </div>
  );
}
