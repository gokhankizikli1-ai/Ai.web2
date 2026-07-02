import { motion } from 'framer-motion';
import {
  Sparkles,
} from 'lucide-react';
import Navigation from '@/components/Navigation';
import IntelligenceLayer from '@/components/IntelligenceLayer';
import WorkspaceBackground from '@/components/WorkspaceBackground';
import {
  SuggestionsWidget,
  StatsRowWidget,
  QuickActionsWidget,
  ActivityTimelineWidget,
  ActiveAgentsWidget,
  WorkspaceActivityWidget,
  TrendingStartupsWidget,
  EcommerceOpportunitiesWidget,
  MarketSnapshotWidget,
  QuickLaunchWidget,
  ProductivityStatsWidget,
  RecentGenerationsWidget,
} from '@/components/DashboardWidgets';

export default function HomeDashboard() {
  return (
    <WorkspaceBackground type="default">
      <div className="min-h-screen bg-[#0a0a0a] text-slate-300 flex flex-col">
        <Navigation />
        <IntelligenceLayer variant="compact" />

        <div className="flex-1 overflow-y-auto">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">

            {/* Header */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45 }}
              className="mb-6"
            >
              <div className="flex items-center gap-3 mb-1">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#52677A]/[0.1] border border-[#52677A]/15">
                  <Sparkles className="h-4 w-4 text-[#7890A3]" />
                </div>
                <div>
                  <h1 className="text-xl font-semibold text-white tracking-tight">Command Center</h1>
                  <p className="text-[12px] text-slate-500">Your AI Business Operating System dashboard</p>
                </div>
              </div>
            </motion.div>

            {/* Stats Row — full width */}
            <div className="mb-4">
              <StatsRowWidget />
            </div>

            {/* Main Widget Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Left Column */}
              <div className="space-y-4">
                <QuickLaunchWidget />
                <SuggestionsWidget />
                <ActiveAgentsWidget />
                <ProductivityStatsWidget />
              </div>

              {/* Middle Column */}
              <div className="space-y-4">
                <QuickActionsWidget />
                <ActivityTimelineWidget />
                <MarketSnapshotWidget />
                <RecentGenerationsWidget />
              </div>

              {/* Right Column */}
              <div className="space-y-4">
                <WorkspaceActivityWidget />
                <TrendingStartupsWidget />
                <EcommerceOpportunitiesWidget />
              </div>
            </div>

            {/* Footer spacer */}
            <div className="h-8" />
          </div>
        </div>
      </div>
    </WorkspaceBackground>
  );
}
