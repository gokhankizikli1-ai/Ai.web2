// appPreviewData — deterministic helpers that turn a free-text idea into
// category-aware dashboard chrome (app name, sidebar, module cards, key
// metrics, activity feed) for the App Builder's premium preview shell.
// Nothing here is sent to or read from the backend — it is purely
// decorative chrome around the real, backend-driven <PreviewResult/>.
import { type BuilderCategory, brandNameFromPrompt, detectCategory } from './promptCategory';

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function appNameFromIdea(idea: string): string {
  return brandNameFromPrompt(idea, 'Your App');
}

export type ChromeIcon =
  | 'dashboard' | 'chart' | 'users' | 'settings' | 'cart' | 'package'
  | 'shield' | 'graduation' | 'chat' | 'layers' | 'building' | 'crown'
  | 'wrench' | 'gauge' | 'activity';

export interface SidebarItem { label: string; icon: ChromeIcon }
export interface ModuleCard { label: string; desc: string; icon: ChromeIcon }
export interface ActivityItem { title: string; time: string; tone: 'positive' | 'neutral' | 'warning' }
export interface MockStat { label: string; value: string; delta: string; positive: boolean }

type StatFormatter = (seed: number) => string;

const moneyB = (base: number, spread: number): StatFormatter => (seed) => `$${(base + ((seed >> 2) % spread) / 10).toFixed(1)}B`;
const moneyK = (base: number, spread: number, decimals = 1): StatFormatter => (seed) => `$${(base + ((seed >> 3) % spread) / 10).toFixed(decimals)}k`;
const count = (base: number, spread: number, suffix = ''): StatFormatter => (seed) => `${(base + (seed % spread)).toLocaleString()}${suffix}`;
const percent = (base: number, spread: number): StatFormatter => (seed) => `${base + ((seed >> 4) % spread)}%`;
const ms = (base: number, spread: number): StatFormatter => (seed) => `${base + ((seed >> 5) % spread)}ms`;
const timeVal = (base: number, spread: number, unit: string): StatFormatter => (seed) => `${base + ((seed >> 3) % spread)} ${unit}`;

interface CategoryChrome {
  sidebar: SidebarItem[];
  modules: ModuleCard[];
  activity: ActivityItem[];
  statLabels: [string, string, string];
  statFormatters: [StatFormatter, StatFormatter, StatFormatter];
}

const CHROME: Record<BuilderCategory, CategoryChrome> = {
  finance: {
    sidebar: [
      { label: 'Dashboard', icon: 'dashboard' }, { label: 'Portfolio', icon: 'chart' },
      { label: 'Risk', icon: 'shield' }, { label: 'Settings', icon: 'settings' },
    ],
    modules: [
      { label: 'Order-flow radar', desc: 'Live imbalance detection across venues', icon: 'chart' },
      { label: 'Risk ladder', desc: 'Cross-asset exposure netted in real time', icon: 'shield' },
      { label: 'Audit trail', desc: 'Every signal and override, timestamped', icon: 'gauge' },
    ],
    activity: [
      { title: 'Volatility regime shift detected', time: '2m ago', tone: 'warning' },
      { title: 'Desk 12 approaching margin threshold', time: '18m ago', tone: 'warning' },
      { title: 'New signal published to the desk', time: '41m ago', tone: 'positive' },
    ],
    statLabels: ['Assets Under Signal', 'Active Desks', 'Alert Latency'],
    statFormatters: [moneyB(3, 20), count(80, 60), ms(180, 400)],
  },
  analytics: {
    sidebar: [
      { label: 'Overview', icon: 'dashboard' }, { label: 'Reports', icon: 'chart' },
      { label: 'Integrations', icon: 'layers' }, { label: 'Settings', icon: 'settings' },
    ],
    modules: [
      { label: 'Funnel tracker', desc: 'Drop-off ranked by revenue impact', icon: 'chart' },
      { label: 'Cohort retention', desc: 'Compare every launch cohort', icon: 'activity' },
      { label: 'Anomaly alerts', desc: 'Paged the moment a metric moves', icon: 'gauge' },
    ],
    activity: [
      { title: 'Checkout funnel drop-off flagged', time: '5m ago', tone: 'warning' },
      { title: 'Weekly report generated', time: '1h ago', tone: 'neutral' },
      { title: 'New anomaly rule created', time: '3h ago', tone: 'positive' },
    ],
    statLabels: ['Events Tracked', 'Active Dashboards', 'Query Latency'],
    statFormatters: [count(600, 900, 'M'), count(20, 80), ms(120, 300)],
  },
  ecommerce: {
    sidebar: [
      { label: 'Overview', icon: 'dashboard' }, { label: 'Orders', icon: 'cart' },
      { label: 'Inventory', icon: 'package' }, { label: 'Customers', icon: 'users' },
    ],
    modules: [
      { label: 'Order pipeline', desc: 'From cart to fulfillment, one queue', icon: 'cart' },
      { label: 'Inventory health', desc: 'Restock urgency ranked by SKU', icon: 'package' },
      { label: 'Customer cohorts', desc: 'Repeat-buyer tracking by launch', icon: 'users' },
    ],
    activity: [
      { title: '12 new orders in the last hour', time: '12m ago', tone: 'positive' },
      { title: 'Low stock alert on a top SKU', time: '34m ago', tone: 'warning' },
      { title: 'Cart recovery email sent to 84 customers', time: '2h ago', tone: 'neutral' },
    ],
    statLabels: ['Orders Today', 'Avg. Order Value', 'Cart Recovery'],
    statFormatters: [count(80, 300), moneyK(600, 400), percent(14, 20)],
  },
  education: {
    sidebar: [
      { label: 'Courses', icon: 'graduation' }, { label: 'Students', icon: 'users' },
      { label: 'Grading', icon: 'layers' }, { label: 'Settings', icon: 'settings' },
    ],
    modules: [
      { label: 'Cohort progress', desc: 'Who’s falling behind, before it happens', icon: 'chart' },
      { label: 'Grading queue', desc: 'Rubric-based, clears in minutes', icon: 'layers' },
      { label: 'Certificates', desc: 'Issued automatically on completion', icon: 'crown' },
    ],
    activity: [
      { title: '14 students completed the current module', time: '20m ago', tone: 'positive' },
      { title: 'Grading queue has pending submissions', time: '1h ago', tone: 'neutral' },
      { title: '2 students flagged as at-risk', time: '3h ago', tone: 'warning' },
    ],
    statLabels: ['Active Students', 'Completion Rate', 'Time to Certify'],
    statFormatters: [count(300, 2000), percent(70, 25), timeVal(4, 6, 'weeks')],
  },
  creator: {
    sidebar: [
      { label: 'Studio', icon: 'layers' }, { label: 'Schedule', icon: 'dashboard' },
      { label: 'Audience', icon: 'users' }, { label: 'Settings', icon: 'settings' },
    ],
    modules: [
      { label: 'Content calendar', desc: 'Draft, scheduled and published, one board', icon: 'layers' },
      { label: 'Audience growth', desc: 'Format-level growth tracking', icon: 'chart' },
      { label: 'Rate-card generator', desc: 'Updates itself as you grow', icon: 'crown' },
    ],
    activity: [
      { title: 'Newsletter scheduled for tomorrow morning', time: '8m ago', tone: 'neutral' },
      { title: 'Audience crossed a new milestone', time: '2h ago', tone: 'positive' },
      { title: 'New sponsorship inquiry received', time: '5h ago', tone: 'positive' },
    ],
    statLabels: ['Posts Scheduled', 'Audience Growth', 'Avg. Engagement'],
    statFormatters: [count(300, 900), percent(8, 20), percent(3, 12)],
  },
  agency: {
    sidebar: [
      { label: 'Work', icon: 'layers' }, { label: 'Clients', icon: 'users' },
      { label: 'Process', icon: 'building' }, { label: 'Settings', icon: 'settings' },
    ],
    modules: [
      { label: 'Client portal', desc: 'Comment directly on live work', icon: 'layers' },
      { label: 'Sprint tracker', desc: 'Scoped, dated, no open-ended retainer', icon: 'building' },
      { label: 'Launch reports', desc: 'A before/after report stakeholders read', icon: 'chart' },
    ],
    activity: [
      { title: 'Client approved the final brand system', time: '1h ago', tone: 'positive' },
      { title: 'New comment on homepage review', time: '2h ago', tone: 'neutral' },
      { title: 'Next sprint kicked off', time: '6h ago', tone: 'neutral' },
    ],
    statLabels: ['Active Projects', 'Avg. Timeline', 'Client Retention'],
    statFormatters: [count(3, 12), timeVal(3, 5, 'weeks'), percent(80, 15)],
  },
  portfolio: {
    sidebar: [
      { label: 'Work', icon: 'layers' }, { label: 'About', icon: 'users' }, { label: 'Contact', icon: 'chat' },
    ],
    modules: [
      { label: 'Case studies', desc: 'Selected work, shown not described', icon: 'layers' },
      { label: 'Capabilities', desc: 'Product, brand and front-end craft', icon: 'wrench' },
      { label: 'Contact', desc: 'Open to select new projects', icon: 'chat' },
    ],
    activity: [
      { title: 'New case study published', time: '1d ago', tone: 'positive' },
      { title: 'New inquiry received', time: '2d ago', tone: 'neutral' },
    ],
    statLabels: ['Projects Shipped', 'Years in Practice', 'Industries'],
    statFormatters: [count(40, 60), count(4, 8), count(6, 8)],
  },
  internal_tool: {
    sidebar: [
      { label: 'Operations', icon: 'dashboard' }, { label: 'Requests', icon: 'layers' },
      { label: 'Reports', icon: 'chart' }, { label: 'Access', icon: 'shield' },
    ],
    modules: [
      { label: 'Request queue', desc: 'Approvals routed automatically', icon: 'layers' },
      { label: 'Audit log', desc: 'Every change, timestamped', icon: 'gauge' },
      { label: 'Access control', desc: 'Scoped by role, not shared logins', icon: 'shield' },
    ],
    activity: [
      { title: 'Request approved by Operations', time: '6m ago', tone: 'positive' },
      { title: 'Role permissions updated', time: '1h ago', tone: 'neutral' },
      { title: 'Weekly ops summary exported', time: '4h ago', tone: 'neutral' },
    ],
    statLabels: ['Manual Steps Removed', 'Avg. Turnaround', 'Active Teams'],
    statFormatters: [count(15, 40), percent(40, 30), count(4, 25)],
  },
  saas: {
    sidebar: [
      { label: 'Pipeline', icon: 'dashboard' }, { label: 'Leads', icon: 'users' },
      { label: 'Integrations', icon: 'layers' }, { label: 'Settings', icon: 'settings' },
    ],
    modules: [
      { label: 'Deal automation', desc: 'Stages advance from real signals', icon: 'chart' },
      { label: 'Lead scoring', desc: 'Prioritize by close likelihood', icon: 'users' },
      { label: 'Integration hub', desc: 'Synced with your existing stack', icon: 'layers' },
    ],
    activity: [
      { title: 'Deal moved to Negotiation', time: '10m ago', tone: 'positive' },
      { title: 'Forecast accuracy updated', time: '2h ago', tone: 'neutral' },
      { title: 'New integration connected', time: '5h ago', tone: 'neutral' },
    ],
    statLabels: ['Deals Tracked', 'Forecast Accuracy', 'Active Teams'],
    statFormatters: [count(500, 2000), percent(85, 12), count(10, 90)],
  },
  ai: {
    sidebar: [
      { label: 'Product', icon: 'chat' }, { label: 'Runs', icon: 'activity' },
      { label: 'Guardrails', icon: 'shield' }, { label: 'Settings', icon: 'settings' },
    ],
    modules: [
      { label: 'Tool orchestration', desc: 'Chains real actions, not just replies', icon: 'chart' },
      { label: 'Guardrail policies', desc: 'Scoped in plain language', icon: 'shield' },
      { label: 'Session memory', desc: 'Context persists across a project', icon: 'layers' },
    ],
    activity: [
      { title: 'Task completed autonomously', time: '3m ago', tone: 'positive' },
      { title: 'Guardrail policy updated', time: '40m ago', tone: 'neutral' },
      { title: 'New session started with memory restored', time: '2h ago', tone: 'neutral' },
    ],
    statLabels: ['Tasks Completed', 'Avg. Response Time', 'Active Teams'],
    statFormatters: [count(800, 3000, 'K'), ms(900, 600), count(10, 90)],
  },
  dashboard: {
    sidebar: [
      { label: 'Overview', icon: 'dashboard' }, { label: 'Analytics', icon: 'chart' },
      { label: 'Team', icon: 'users' }, { label: 'Settings', icon: 'settings' },
    ],
    modules: [
      { label: 'Unified metric feed', desc: 'Every team’s KPIs, one page', icon: 'chart' },
      { label: 'Activity log', desc: 'What changed, who changed it', icon: 'activity' },
      { label: 'Alert rules', desc: 'Notified when a metric crosses a line', icon: 'gauge' },
    ],
    activity: [
      { title: 'Weekly exec summary generated', time: '30m ago', tone: 'neutral' },
      { title: 'Metric threshold breached', time: '1h ago', tone: 'warning' },
      { title: 'New teammate invited', time: '3h ago', tone: 'positive' },
    ],
    statLabels: ['Active Users', 'This Month', 'Growth Rate'],
    statFormatters: [count(800, 9200), moneyK(20, 480), percent(4, 36)],
  },
};

export interface AppChrome {
  category: BuilderCategory;
  sidebar: SidebarItem[];
  modules: ModuleCard[];
  activity: ActivityItem[];
  stats: MockStat[];
}

export function chromeFromIdea(idea: string): AppChrome {
  const category = detectCategory(idea);
  const chrome = CHROME[category];
  const seed = hashString(idea || 'korvix');
  const stats: MockStat[] = chrome.statLabels.map((label, i) => {
    const positive = i !== 2 || ((seed >> (i + 1)) % 100) > 25;
    const deltaSeed = (seed >> (i * 3)) % 12;
    return {
      label,
      value: chrome.statFormatters[i](seed + i * 97),
      delta: `${positive ? '+' : '-'}${deltaSeed + 2}%`,
      positive,
    };
  });
  return { category, sidebar: chrome.sidebar, modules: chrome.modules, activity: chrome.activity, stats };
}

// Kept for any existing callers — thin wrapper over chromeFromIdea().
export function mockStatsFromIdea(idea: string): MockStat[] {
  return chromeFromIdea(idea).stats;
}
