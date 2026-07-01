// siteContent — deterministic prompt → premium landing-page copy generator
// for the Website Builder preview. Replaces the old static SITE_CONTENT
// constant: every prompt now gets its own headline, features, metrics,
// showcase section, pricing and FAQ, adapted to the detected product
// category (and, once answered, the Design Brief's visual style / color
// direction / density). Pure string logic — no LLM, no network.
import {
  type BuilderCategory, detectCategory, detectRetailFlavor,
  brandNameFromPrompt, paletteForDirection,
} from './promptCategory';
import type { DesignBriefAnswers } from '@/lib/designBrief';

export type MockupKind = 'dashboard' | 'commerce' | 'gallery' | 'chat' | 'timeline' | 'workflow';

export type FeatureIcon =
  | 'chart' | 'bolt' | 'users' | 'shield' | 'cart' | 'tag' | 'card' | 'package'
  | 'layers' | 'gauge' | 'pie' | 'activity' | 'graduation' | 'rocket' | 'crown'
  | 'building' | 'wrench' | 'globe' | 'chat' | 'sparkles';

export interface SiteContent {
  category: BuilderCategory;
  /** The resolved (possibly synthesized) product-style brand name shown in the navbar/footer. */
  brandName: string;
  nav: string[];
  hero: {
    eyebrow: string;
    headline: string;
    subheadline: string;
    primaryCta: string;
    secondaryCta: string;
    mockup: MockupKind;
  };
  metrics: Array<{ label: string; value: string }>;
  features: Array<{ title: string; desc: string; icon: FeatureIcon }>;
  showcase: {
    eyebrow: string;
    title: string;
    description: string;
    kind: MockupKind;
    points: string[];
  };
  pricing: Array<{ name: string; price: string; period: string; desc: string; highlighted: boolean }>;
  testimonials: Array<{ quote: string; name: string; role: string }>;
  faq: Array<{ q: string; a: string }>;
  brand: Array<{ hex: string; label: string }>;
  typography: string;
  cta: { headline: string; subtext: string; button: string };
}

interface Ctx {
  brand: string;
  retail: boolean;
}

function tier(name: string, price: string, period: string, desc: string, highlighted = false) {
  return { name, price, period, desc, highlighted };
}

// ── Per-category copy banks ────────────────────────────────────────────

function financeContent(ctx: Ctx): Omit<SiteContent, 'category' | 'brand' | 'typography'> {
  const { brand } = ctx;
  return {
    nav: ['Markets', 'Portfolio', 'Risk', 'Pricing'],
    hero: {
      eyebrow: 'Institutional-grade trading intelligence',
      headline: `${brand} turns market noise into a single conviction score`,
      subheadline: 'Live order-flow, options skew and on-chain signals collapsed into one risk-adjusted read — built for desks that can’t afford to be a session late.',
      primaryCta: 'Request desk access', secondaryCta: 'See a live session', mockup: 'dashboard',
    },
    metrics: [
      { label: 'Assets under signal', value: '$4.8B' },
      { label: 'Median alert latency', value: '340ms' },
      { label: 'Desks live today', value: '112' },
    ],
    features: [
      { title: 'Order-flow imbalance radar', desc: 'Spot institutional accumulation before it prints on the tape.', icon: 'chart' },
      { title: 'Cross-asset risk ladder', desc: 'Equities, futures and crypto exposure netted on one page.', icon: 'shield' },
      { title: 'Volatility regime detector', desc: 'Know the moment the market has quietly changed character.', icon: 'activity' },
      { title: 'Desk-wide audit trail', desc: 'Every signal and override, timestamped for compliance review.', icon: 'gauge' },
    ],
    showcase: {
      eyebrow: 'THE DESK VIEW', title: 'One screen, every position',
      description: `${brand} replaces six terminal tabs with a single command view — exposure, P&L and risk in the same glance.`,
      kind: 'dashboard', points: ['Net exposure by asset class', 'Intraday P&L attribution', 'Margin headroom alerts'],
    },
    pricing: [
      tier('Desk', '$249', '/mo', '1 seat, core signal feed, 15-minute delayed backtests.'),
      tier('Trading Floor', '$890', '/mo', 'Up to 10 seats, live signals, priority data latency.', true),
      tier('Institutional', 'Custom', '', 'Dedicated infrastructure, compliance exports, SSO.'),
    ],
    testimonials: [
      { quote: `We killed two vendor terminals the week we onboarded ${brand}.`, name: 'Priya Nair', role: 'Head of Trading, Cobalt Capital' },
      { quote: 'The regime detector caught a vol shift four hours before our old model did.', name: 'Marcus Lee', role: 'Portfolio Manager' },
      { quote: 'Compliance finally gets one export instead of five.', name: 'Ava Chen', role: 'COO, Northwind Partners' },
    ],
    faq: [
      { q: 'Where does the data come from?', a: 'Direct exchange feeds plus licensed on-chain and options data — no scraped or delayed retail sources.' },
      { q: 'Can compliance audit every signal?', a: 'Every alert and override is timestamped and exportable for your audit trail.' },
      { q: 'Do you support crypto and equities together?', a: 'Yes — exposure nets across asset classes on the same risk ladder.' },
    ],
    cta: {
      headline: `Ready to trade with the ${brand} edge?`,
      subtext: 'Get desk access this week — no multi-quarter procurement cycle.',
      button: 'Request access',
    },
  };
}

function analyticsContent(ctx: Ctx): Omit<SiteContent, 'category' | 'brand' | 'typography'> {
  const { brand, retail } = ctx;
  if (retail) {
    return {
      nav: ['Overview', 'Revenue', 'Inventory', 'Customers'],
      hero: {
        eyebrow: 'Commerce analytics for merchandising teams',
        headline: `${brand} shows exactly which products are making you money — and which are quietly bleeding margin`,
        subheadline: 'Revenue, inventory turns, campaign ROI and customer cohorts in one dashboard — no more stitching together five storefront apps.',
        primaryCta: 'See the dashboard', secondaryCta: 'Watch a 90-second tour', mockup: 'dashboard',
      },
      metrics: [
        { label: 'GMV tracked', value: '$182M' },
        { label: 'SKUs monitored', value: '48K' },
        { label: 'Merchants live', value: '1,240' },
      ],
      features: [
        { title: 'Revenue by collection', desc: 'See which drops actually drive margin, not just units sold.', icon: 'chart' },
        { title: 'Inventory health score', desc: 'Catch slow-moving SKUs before they turn into a clearance problem.', icon: 'package' },
        { title: 'Campaign-to-revenue tracing', desc: 'Connect every paid and email campaign straight to attributed revenue.', icon: 'bolt' },
        { title: 'Customer cohort retention', desc: 'Know which launch brought back repeat buyers, and which didn’t.', icon: 'users' },
      ],
      showcase: {
        eyebrow: 'MERCHANDISING VIEW', title: 'Every product, ranked by what it actually earns',
        description: `${brand} blends revenue, returns and ad spend into one profitability score per SKU.`,
        kind: 'dashboard', points: ['Margin-adjusted best-sellers', 'Restock urgency ranking', 'Campaign ROI by channel'],
      },
      pricing: [
        tier('Boutique', '$79', '/mo', '1 store, core revenue + inventory reports.'),
        tier('Growth', '$249', '/mo', 'Up to 5 stores, campaign attribution, cohort retention.', true),
        tier('Enterprise Retail', 'Custom', '', 'Multi-brand rollup, dedicated data pipeline, SLA.'),
      ],
      testimonials: [
        { quote: `${brand} showed us our best-selling color was losing money on returns. We’d never have caught that.`, name: 'Elena Ruiz', role: 'Head of Merchandising, Marlowe & Co.' },
        { quote: 'Restock decisions used to take a Friday afternoon. Now it’s a five-minute glance.', name: 'Diego Ramirez', role: 'Ops Lead' },
        { quote: 'Our campaign ROI numbers finally match finance’s numbers.', name: 'Sofia Müller', role: 'Growth Marketing Manager' },
      ],
      faq: [
        { q: 'Which platforms do you connect to?', a: 'Shopify, WooCommerce and a direct API — inventory and orders sync within minutes.' },
        { q: 'Does it replace our ad platform dashboards?', a: 'No — it attributes their spend to actual revenue in one place instead of five separate logins.' },
        { q: 'Can I export for finance?', a: 'Every report exports to CSV or a scheduled email digest.' },
      ],
      cta: {
        headline: `Stop guessing which products earn their shelf space`,
        subtext: `${brand} pays for itself the first time it flags a losing SKU.`,
        button: 'Start free trial',
      },
    };
  }
  return {
    nav: ['Overview', 'Reports', 'Integrations', 'Pricing'],
    hero: {
      eyebrow: 'Product analytics without the SQL',
      headline: `${brand} turns your raw event stream into decisions your team actually acts on`,
      subheadline: 'Funnels, cohorts and anomaly alerts wired straight to the metrics your team already tracks.',
      primaryCta: 'Explore the dashboard', secondaryCta: 'Watch a 90-second tour', mockup: 'dashboard',
    },
    metrics: [
      { label: 'Events processed daily', value: '2.1B' },
      { label: 'Median query time', value: '180ms' },
      { label: 'Teams onboarded', value: '640' },
    ],
    features: [
      { title: 'Funnel drop-off detection', desc: 'See the exact step where users give up, ranked by revenue impact.', icon: 'chart' },
      { title: 'Cohort retention curves', desc: 'Compare every launch cohort against the one before it.', icon: 'activity' },
      { title: 'Anomaly alerting', desc: 'Get paged the moment a core metric moves outside its normal band.', icon: 'bolt' },
      { title: 'One-click report sharing', desc: 'Send a live, filtered view to stakeholders — no screenshots.', icon: 'layers' },
    ],
    showcase: {
      eyebrow: 'PRODUCT VIEW', title: 'From raw events to a decision in one screen',
      description: `${brand} keeps the underlying event schema out of the way — your team sees decisions, not tables.`,
      kind: 'dashboard', points: ['Funnel-stage conversion', 'Cohort retention by week', 'Anomaly alert timeline'],
    },
    pricing: [
      tier('Starter', '$49', '/mo', '1 product, 100K events/mo, 3 dashboards.'),
      tier('Team', '$199', '/mo', 'Unlimited dashboards, anomaly alerts, cohort tools.', true),
      tier('Enterprise', 'Custom', '', 'SSO, data residency, dedicated support engineer.'),
    ],
    testimonials: [
      { quote: `We found a checkout drop-off ${brand} flagged that our old tool never surfaced.`, name: 'Noah Kim', role: 'Head of Growth' },
      { quote: 'The anomaly alert paged us four hours before a partner-reported outage.', name: 'Ava Chen', role: 'VP Product' },
      { quote: 'Our whole team finally looks at the same numbers.', name: 'Marcus Lee', role: 'Data Lead' },
    ],
    faq: [
      { q: 'Do we need to write SQL?', a: 'No — every report is built from clickable filters; raw SQL access is available for power users.' },
      { q: 'How is this different from our warehouse?', a: 'It sits on top of it and turns tables into funnels, cohorts and alerts your team can actually read.' },
      { q: 'Can non-technical teammates use it?', a: 'Yes — dashboards are shareable read-only links with no login friction.' },
    ],
    cta: {
      headline: `Stop exporting spreadsheets to explain your own metrics`,
      subtext: `${brand} is live in under a day, on top of the data you already have.`,
      button: 'Start free trial',
    },
  };
}

function ecommerceContent(ctx: Ctx): Omit<SiteContent, 'category' | 'brand' | 'typography'> {
  const { brand } = ctx;
  return {
    nav: ['Shop', 'Collections', 'About', 'Support'],
    hero: {
      eyebrow: 'A storefront built for the product, not the template',
      headline: `${brand} — the storefront your product line actually deserves`,
      subheadline: 'A fast, editorial storefront with real merchandising — not a generic theme with your logo pasted on top.',
      primaryCta: 'Shop the collection', secondaryCta: 'See what’s new', mockup: 'commerce',
    },
    metrics: [
      { label: 'Avg. checkout time', value: '38s' },
      { label: 'Cart recovery lift', value: '+22%' },
      { label: 'Mobile conversion lift', value: '+31%' },
    ],
    features: [
      { title: 'One-page express checkout', desc: 'Apple Pay, saved cards and address autofill in a single step.', icon: 'card' },
      { title: 'Size & fit guidance', desc: 'Cuts returns by showing the right size before checkout, not after.', icon: 'tag' },
      { title: 'Abandoned-cart recovery', desc: 'A timed, on-brand nudge sequence that doesn’t feel like spam.', icon: 'cart' },
      { title: 'Loyalty tiers', desc: 'Repeat buyers unlock early access automatically, no extra app.', icon: 'crown' },
    ],
    showcase: {
      eyebrow: 'THE SHOP', title: 'Merchandising that feels curated, not generated',
      description: `${brand} lays out every collection like an editorial drop, with live stock and size signals baked in.`,
      kind: 'commerce', points: ['Editorial product grid', 'Live inventory badges', 'One-page express checkout'],
    },
    pricing: [
      tier('Launch', '$39', '/mo', '1 storefront, up to 200 SKUs, standard checkout.'),
      tier('Growth', '$129', '/mo', 'Unlimited SKUs, loyalty tiers, cart recovery flows.', true),
      tier('Scale', 'Custom', '', 'Multi-storefront, dedicated CDN, priority support.'),
    ],
    testimonials: [
      { quote: `Cart recovery alone paid for ${brand} in the first month.`, name: 'Sofia Müller', role: 'Founder, Atelier Noir' },
      { quote: 'The size guidance genuinely cut our returns rate.', name: 'Diego Ramirez', role: 'Ecommerce Manager' },
      { quote: 'It’s the first storefront that actually looks like our brand.', name: 'Elena Ruiz', role: 'Creative Director' },
    ],
    faq: [
      { q: 'Can I migrate my existing catalog?', a: 'Yes — bulk import from a CSV or your current storefront in minutes.' },
      { q: 'Does checkout support Apple Pay and Google Pay?', a: 'Both are on by default, alongside standard card checkout.' },
      { q: 'What happens to abandoned carts?', a: 'A three-step recovery sequence sends automatically, tuned to your brand voice.' },
    ],
    cta: {
      headline: `Give your product line the storefront it deserves`,
      subtext: 'Launch in an afternoon — your catalog, your brand, no template ceiling.',
      button: 'Start selling',
    },
  };
}

function educationContent(ctx: Ctx): Omit<SiteContent, 'category' | 'brand' | 'typography'> {
  const { brand } = ctx;
  return {
    nav: ['Courses', 'Curriculum', 'Educators', 'Pricing'],
    hero: {
      eyebrow: 'Courses students actually finish',
      headline: `${brand} turns your curriculum into a course students actually complete`,
      subheadline: 'Adaptive pacing, cohort progress tracking and instructor tools that catch a struggling student before they drop off.',
      primaryCta: 'Preview the curriculum', secondaryCta: 'Talk to an educator', mockup: 'timeline',
    },
    metrics: [
      { label: 'Course completion rate', value: '87%' },
      { label: 'Avg. time to certify', value: '6 weeks' },
      { label: 'Educators onboarded', value: '2,300' },
    ],
    features: [
      { title: 'Adaptive lesson pacing', desc: 'Slows down or skips ahead based on how a student is actually performing.', icon: 'graduation' },
      { title: 'Cohort progress tracking', desc: 'Instructors see exactly who’s falling behind, before the drop-off happens.', icon: 'chart' },
      { title: 'Instructor grading queue', desc: 'Rubric-based grading that clears in minutes, not weekends.', icon: 'layers' },
      { title: 'Certificate issuance', desc: 'Verifiable, shareable certificates the moment a student finishes.', icon: 'crown' },
    ],
    showcase: {
      eyebrow: 'STUDENT VIEW', title: 'A clear path from lesson one to certified',
      description: `${brand} shows every learner exactly where they stand and what’s next — never a wall of unordered modules.`,
      kind: 'timeline', points: ['Module-by-module progress', 'Instructor feedback inline', 'Certificate on completion'],
    },
    pricing: [
      tier('Educator', '$29', '/mo', '1 course, up to 50 students, grading tools.'),
      tier('Academy', '$149', '/mo', 'Unlimited courses, cohort analytics, certificates.', true),
      tier('Institution', 'Custom', '', 'SSO, LMS integration, dedicated success manager.'),
    ],
    testimonials: [
      { quote: `Completion went from 41% to 87% the term we switched to ${brand}.`, name: 'Priya Nair', role: 'Program Director' },
      { quote: 'Grading used to eat my weekends. Now it’s done by Sunday morning.', name: 'Marcus Lee', role: 'Lead Instructor' },
      { quote: 'The pacing engine caught students falling behind before I would have noticed.', name: 'Ava Chen', role: 'Curriculum Lead' },
    ],
    faq: [
      { q: 'Can I import an existing curriculum?', a: 'Yes — bring your modules and slides in, pacing rules layer on top automatically.' },
      { q: 'Do certificates need manual approval?', a: 'No, they issue automatically on completion, with an optional instructor sign-off step.' },
      { q: 'Does it integrate with our LMS?', a: 'Yes, via LTI — grades and rosters sync both ways.' },
    ],
    cta: {
      headline: `Stop losing students to a confusing course structure`,
      subtext: `${brand} is ready for your next cohort in under a week.`,
      button: 'Launch your course',
    },
  };
}

function creatorContent(ctx: Ctx): Omit<SiteContent, 'category' | 'brand' | 'typography'> {
  const { brand } = ctx;
  return {
    nav: ['Studio', 'Schedule', 'Audience', 'Pricing'],
    hero: {
      eyebrow: 'One calendar for everything you publish',
      headline: `${brand} keeps every post, episode and newsletter on one content calendar`,
      subheadline: 'Cross-platform scheduling, audience growth tracking and a sponsorship rate card that updates itself.',
      primaryCta: 'Plan your week', secondaryCta: 'See the calendar', mockup: 'workflow',
    },
    metrics: [
      { label: 'Posts scheduled monthly', value: '46K' },
      { label: 'Avg. time saved weekly', value: '6.5 hrs' },
      { label: 'Creators on platform', value: '8,900' },
    ],
    features: [
      { title: 'Cross-platform scheduling', desc: 'One draft, tuned and queued across every channel you publish to.', icon: 'chat' },
      { title: 'Audience growth tracking', desc: 'See which format actually grows your audience, not just what gets likes.', icon: 'chart' },
      { title: 'Sponsorship rate-card generator', desc: 'Your rate card updates itself as your numbers grow.', icon: 'crown' },
      { title: 'Content repurposing queue', desc: 'Turn one long-form piece into a week of shorter posts automatically.', icon: 'layers' },
    ],
    showcase: {
      eyebrow: 'CONTENT OS', title: 'Your whole publishing pipeline, one board',
      description: `${brand} lays out drafts, scheduled posts and published pieces on one board so nothing slips a deadline.`,
      kind: 'workflow', points: ['Draft → scheduled → published board', 'Per-platform performance', 'Sponsorship pipeline'],
    },
    pricing: [
      tier('Creator', '$19', '/mo', '3 channels, scheduling, basic growth analytics.'),
      tier('Studio', '$59', '/mo', 'Unlimited channels, repurposing queue, rate-card tool.', true),
      tier('Agency', 'Custom', '', 'Multiple creator seats, client reporting, priority support.'),
    ],
    testimonials: [
      { quote: `${brand} gave me my Sunday evenings back.`, name: 'Diego Ramirez', role: 'Newsletter creator, 62K subscribers' },
      { quote: 'My rate card finally matches my actual reach, automatically.', name: 'Sofia Müller', role: 'Podcast host' },
      { quote: 'Repurposing one video into a week of posts used to take me hours.', name: 'Noah Kim', role: 'Content creator' },
    ],
    faq: [
      { q: 'Which platforms do you support?', a: 'Instagram, TikTok, YouTube, X and email newsletter delivery, with more added regularly.' },
      { q: 'Does scheduling post natively or redirect?', a: 'Native publishing wherever the platform API allows it — no redirect links.' },
      { q: 'Can I track sponsorship performance?', a: 'Yes — every sponsored post gets its own performance and payout summary.' },
    ],
    cta: {
      headline: `Stop juggling five apps to publish one idea`,
      subtext: `${brand} is free to try with your first three channels.`,
      button: 'Start free',
    },
  };
}

function agencyContent(ctx: Ctx): Omit<SiteContent, 'category' | 'brand' | 'typography'> {
  const { brand } = ctx;
  return {
    nav: ['Work', 'Services', 'Process', 'Contact'],
    hero: {
      eyebrow: 'Brand systems, not just decks',
      headline: `${brand} is the studio that ships brand systems, not just decks`,
      subheadline: 'Identity, product design and launch-ready front-end craft, delivered on a sprint timeline — not a quarter-long retainer.',
      primaryCta: 'See our work', secondaryCta: 'Start a project', mockup: 'gallery',
    },
    metrics: [
      { label: 'Brands launched', value: '140+' },
      { label: 'Avg. project timeline', value: '5 weeks' },
      { label: 'Client retention', value: '92%' },
    ],
    features: [
      { title: 'Full brand systems', desc: 'Logo, type, color and components delivered as a working design system.', icon: 'crown' },
      { title: 'Client review portal', desc: 'Comment directly on live work — no more feedback buried in email threads.', icon: 'layers' },
      { title: 'Sprint-based delivery', desc: 'A scoped, dated sprint plan — not an open-ended retainer with no finish line.', icon: 'rocket' },
      { title: 'Launch reporting', desc: 'A clear before/after report your stakeholders can actually read.', icon: 'chart' },
    ],
    showcase: {
      eyebrow: 'SELECTED WORK', title: 'Recent launches from the studio',
      description: `${brand} ships a finished brand system and a working site, not a slide deck of concepts.`,
      kind: 'gallery', points: ['Identity + design system', 'Marketing site build', 'Launch performance report'],
    },
    pricing: [
      tier('Sprint', '$4,900', '', 'A single scoped deliverable — identity or a landing page.'),
      tier('Launch', '$14,500', '', 'Full brand system plus a production-ready site.', true),
      tier('Partnership', 'Custom', '', 'Ongoing design partnership across multiple launches.'),
    ],
    testimonials: [
      { quote: `${brand} shipped in five weeks what our last agency quoted six months for.`, name: 'Elena Ruiz', role: 'Founder, Marlowe & Co.' },
      { quote: 'The review portal alone saved us a dozen confusing email threads.', name: 'Ava Chen', role: 'Marketing Director' },
      { quote: 'They handed us a design system our own team could actually maintain.', name: 'Marcus Lee', role: 'Head of Product' },
    ],
    faq: [
      { q: 'How long does a typical engagement take?', a: 'Most sprints land between 3 and 6 weeks, scoped up front with fixed pricing.' },
      { q: 'Do we own the final files?', a: 'Yes — full source files and the design system are yours on delivery.' },
      { q: 'Can you work with our existing brand?', a: 'Yes, we regularly extend or modernize an existing identity rather than starting over.' },
    ],
    cta: {
      headline: `Let’s build something worth showing`,
      subtext: `${brand} takes on a limited number of sprints each quarter.`,
      button: 'Start a project',
    },
  };
}

function portfolioContent(ctx: Ctx): Omit<SiteContent, 'category' | 'brand' | 'typography'> {
  const { brand } = ctx;
  return {
    nav: ['Work', 'About', 'Contact'],
    hero: {
      eyebrow: 'Selected work',
      headline: `${brand} — product design and brand systems, selected work`,
      subheadline: 'A working practice across product design, identity and front-end craft — shown, not just described.',
      primaryCta: 'View the work', secondaryCta: 'Get in touch', mockup: 'gallery',
    },
    metrics: [
      { label: 'Projects shipped', value: '62' },
      { label: 'Years in practice', value: '8' },
      { label: 'Industries', value: '11' },
    ],
    features: [
      { title: 'Product design systems', desc: 'End-to-end component libraries built for real engineering handoff.', icon: 'layers' },
      { title: 'Brand identity', desc: 'Logo, type and color systems designed to hold up past the pitch deck.', icon: 'crown' },
      { title: 'Motion & prototyping', desc: 'Interaction work that survives contact with a real engineering sprint.', icon: 'bolt' },
      { title: 'Front-end craft', desc: 'Pixel-accurate builds, not just static comps handed to someone else.', icon: 'wrench' },
    ],
    showcase: {
      eyebrow: 'RECENT WORK', title: 'A few projects worth a closer look',
      description: `${brand}’s recent work spans product, brand and front-end delivery for teams that ship.`,
      kind: 'gallery', points: ['Case study: product redesign', 'Case study: brand identity', 'Case study: launch site'],
    },
    pricing: [],
    testimonials: [
      { quote: `${brand} understood the product better than some of our own team did.`, name: 'Priya Nair', role: 'Head of Product' },
      { quote: 'Rare to find someone who designs AND ships the front end.', name: 'Diego Ramirez', role: 'Engineering Lead' },
      { quote: 'The brand system is still exactly what we use, two years later.', name: 'Sofia Müller', role: 'Founder' },
    ],
    faq: [
      { q: 'Are you available for new projects?', a: 'Selectively — reach out with project scope and timeline and I’ll reply within two days.' },
      { q: 'Do you take on both product and brand work?', a: 'Yes, most projects blend the two rather than treating them as separate tracks.' },
      { q: 'Can you work with an existing engineering team?', a: 'Yes — most engagements hand off directly into an existing codebase.' },
    ],
    cta: {
      headline: `Let’s build something worth showing`,
      subtext: 'Open to select new projects this quarter.',
      button: 'Get in touch',
    },
  };
}

function internalToolContent(ctx: Ctx): Omit<SiteContent, 'category' | 'brand' | 'typography'> {
  const { brand } = ctx;
  return {
    nav: ['Operations', 'Requests', 'Reports', 'Access'],
    hero: {
      eyebrow: 'The internal console your ops team stops fighting',
      headline: `${brand} is the internal console your ops team stops fighting with`,
      subheadline: 'Role-based access, a real audit log and one-click reporting — replacing the spreadsheet-and-Slack-thread workflow.',
      primaryCta: 'View the console', secondaryCta: 'Request access', mockup: 'workflow',
    },
    metrics: [
      { label: 'Manual steps removed', value: '34' },
      { label: 'Avg. request turnaround', value: '−64%' },
      { label: 'Teams using it daily', value: '19' },
    ],
    features: [
      { title: 'Role-based access', desc: 'Every action scoped to a role, not a shared login everyone uses.', icon: 'shield' },
      { title: 'Full audit log', desc: 'Every change, timestamped and attributable, for every table you manage.', icon: 'gauge' },
      { title: 'Request queue automation', desc: 'Approvals route to the right person automatically, no more Slack pings.', icon: 'bolt' },
      { title: 'One-click reporting export', desc: 'A weekly ops summary that used to take an afternoon to compile.', icon: 'chart' },
    ],
    showcase: {
      eyebrow: 'OPS VIEW', title: 'Every request, every approval, one queue',
      description: `${brand} replaces the ad hoc spreadsheet-and-Slack workflow with a single accountable queue.`,
      kind: 'workflow', points: ['Pending approvals by owner', 'Full change audit trail', 'Weekly ops summary export'],
    },
    pricing: [],
    testimonials: [
      { quote: `${brand} finally gave us an audit trail our compliance team stopped asking about.`, name: 'Ava Chen', role: 'Operations Director' },
      { quote: 'Request turnaround dropped from two days to same-afternoon.', name: 'Marcus Lee', role: 'Ops Manager' },
      { quote: 'No more hunting through Slack to find who approved what.', name: 'Priya Nair', role: 'IT Lead' },
    ],
    faq: [
      { q: 'Can we restrict access by team?', a: 'Yes, every view and action is scoped by role and team.' },
      { q: 'Does it integrate with our identity provider?', a: 'Yes, SSO via SAML or OIDC is supported out of the box.' },
      { q: 'Is there an audit export for compliance?', a: 'Every change is logged and exportable to CSV on demand.' },
    ],
    cta: {
      headline: `Stop running operations out of a shared spreadsheet`,
      subtext: `${brand} is ready to roll out to your first team this week.`,
      button: 'Request access',
    },
  };
}

function saasContent(ctx: Ctx): Omit<SiteContent, 'category' | 'brand' | 'typography'> {
  const { brand } = ctx;
  return {
    nav: ['Product', 'Pipeline', 'Integrations', 'Pricing'],
    hero: {
      eyebrow: 'Pipeline software your reps actually update',
      headline: `${brand} keeps your pipeline moving without the spreadsheet duct tape`,
      subheadline: 'Deal-stage automation, lead scoring and forecast accuracy tracking, wired into the tools your team already uses.',
      primaryCta: 'See it in action', secondaryCta: 'Talk to sales', mockup: 'dashboard',
    },
    metrics: [
      { label: 'Deals tracked', value: '58K' },
      { label: 'Forecast accuracy', value: '94%' },
      { label: 'Teams onboarded', value: '410' },
    ],
    features: [
      { title: 'Deal-stage automation', desc: 'Stages advance from real signals, not a rep remembering to update a field.', icon: 'bolt' },
      { title: 'Lead scoring', desc: 'Prioritize the accounts most likely to close this quarter.', icon: 'chart' },
      { title: 'Integration hub', desc: 'Syncs with the email, calendar and billing tools your team already runs.', icon: 'layers' },
      { title: 'Forecast accuracy tracking', desc: 'See exactly how close last quarter’s forecast came to reality.', icon: 'gauge' },
    ],
    showcase: {
      eyebrow: 'PIPELINE VIEW', title: 'Every deal, staged automatically',
      description: `${brand} keeps the pipeline honest so forecast reviews stop being a guessing game.`,
      kind: 'dashboard', points: ['Stage-by-stage deal flow', 'Lead score ranking', 'Quarter forecast accuracy'],
    },
    pricing: [
      tier('Starter', '$29', '/mo', '1 user, core pipeline, basic lead scoring.'),
      tier('Team', '$99', '/mo', 'Up to 10 users, forecasting, integration hub.', true),
      tier('Enterprise', 'Custom', '', 'Unlimited users, SSO, dedicated success manager.'),
    ],
    testimonials: [
      { quote: `Our forecast accuracy jumped the quarter we moved to ${brand}.`, name: 'Marcus Lee', role: 'VP Sales' },
      { quote: 'Reps stopped forgetting to log calls because it logs itself.', name: 'Ava Chen', role: 'Sales Ops Lead' },
      { quote: 'Lead scoring alone changed which accounts we called first.', name: 'Diego Ramirez', role: 'Account Executive' },
    ],
    faq: [
      { q: 'Does it replace our CRM?', a: 'It can stand alone or sync bi-directionally with your existing CRM.' },
      { q: 'How is lead scoring calculated?', a: 'From engagement signals and firmographic fit, tunable per your ideal customer profile.' },
      { q: 'Can I see forecast history?', a: 'Yes — every quarter’s forecast is versioned against what actually closed.' },
    ],
    cta: {
      headline: `Stop forecasting off a gut feeling`,
      subtext: `${brand} is live for your team in under a day.`,
      button: 'Start free trial',
    },
  };
}

function aiContent(ctx: Ctx): Omit<SiteContent, 'category' | 'brand' | 'typography'> {
  const { brand } = ctx;
  return {
    nav: ['Product', 'How it works', 'Pricing', 'Docs'],
    hero: {
      eyebrow: 'The copilot that finishes the task',
      headline: `${brand} is the copilot that actually finishes the task, not just suggests one`,
      subheadline: 'Tool-use orchestration, guardrail policies and memory across sessions — built for teams that need finished work, not a draft.',
      primaryCta: 'Try it now', secondaryCta: 'Read the docs', mockup: 'chat',
    },
    metrics: [
      { label: 'Tasks completed autonomously', value: '2.4M' },
      { label: 'Avg. response time', value: '1.1s' },
      { label: 'Teams in production', value: '760' },
    ],
    features: [
      { title: 'Tool-use orchestration', desc: 'Chains real actions across your stack, not just a chat reply.', icon: 'bolt' },
      { title: 'Guardrail policies', desc: 'Define exactly what it’s allowed to touch, in plain language.', icon: 'shield' },
      { title: 'Session memory', desc: 'Remembers context across a project, not just within one thread.', icon: 'layers' },
      { title: 'Audit-ready output logs', desc: 'Every action taken is logged and reviewable after the fact.', icon: 'gauge' },
    ],
    showcase: {
      eyebrow: 'HOW IT WORKS', title: 'From request to finished task',
      description: `${brand} plans, calls the right tools, and reports back — with every step visible, not a black box.`,
      kind: 'chat', points: ['Plan → tool calls → result', 'Guardrail policy enforcement', 'Full action audit log'],
    },
    pricing: [
      tier('Individual', '$20', '/mo', 'Core copilot, standard tool access.'),
      tier('Team', '$60', '/mo', 'Shared workspace, guardrail policies, priority latency.', true),
      tier('Enterprise', 'Custom', '', 'Dedicated infrastructure, SSO, audit exports.'),
    ],
    testimonials: [
      { quote: `${brand} actually finishes the ticket instead of leaving me a draft to clean up.`, name: 'Noah Kim', role: 'Engineering Lead' },
      { quote: 'The audit log made our security review a non-event.', name: 'Priya Nair', role: 'Head of Security' },
      { quote: 'It remembers context across a whole project, which changed how we use it.', name: 'Marcus Lee', role: 'Product Manager' },
    ],
    faq: [
      { q: 'What can it actually take action on?', a: 'Whatever tools you grant it access to, scoped by your guardrail policy.' },
      { q: 'Is every action reviewable?', a: 'Yes — a full, timestamped log of every tool call and result.' },
      { q: 'Does it remember past sessions?', a: 'Yes, memory persists across a project so context doesn’t reset each time.' },
    ],
    cta: {
      headline: `Stop babysitting a copilot that only suggests`,
      subtext: `${brand} is free to try on your first real task.`,
      button: 'Try it now',
    },
  };
}

function dashboardContent(ctx: Ctx): Omit<SiteContent, 'category' | 'brand' | 'typography'> {
  const { brand } = ctx;
  return {
    nav: ['Overview', 'Reports', 'Team', 'Settings'],
    hero: {
      eyebrow: 'The command center your team actually opens',
      headline: `${brand} is the command center your team actually opens every morning`,
      subheadline: 'One unified metric feed, a cross-team activity log and configurable alerts, replacing the tab full of disconnected tools.',
      primaryCta: 'See the dashboard', secondaryCta: 'Talk to us', mockup: 'dashboard',
    },
    metrics: [
      { label: 'Metrics tracked', value: '120+' },
      { label: 'Teams onboarded', value: '85' },
      { label: 'Avg. setup time', value: '12 min' },
    ],
    features: [
      { title: 'Unified metric feed', desc: 'Every team’s KPIs on one page, no more tab-hopping between tools.', icon: 'chart' },
      { title: 'Cross-team activity log', desc: 'See what changed, who changed it, and when, across the whole org.', icon: 'activity' },
      { title: 'Configurable alert rules', desc: 'Get notified the moment a metric crosses a threshold you define.', icon: 'bolt' },
      { title: 'One-click exec summary', desc: 'A shareable weekly digest built automatically from live data.', icon: 'layers' },
    ],
    showcase: {
      eyebrow: 'COMMAND VIEW', title: 'Everything your team tracks, one page',
      description: `${brand} pulls every team’s numbers into a single view built for a Monday morning stand-up.`,
      kind: 'dashboard', points: ['Cross-team KPI feed', 'Alert rule timeline', 'Weekly exec summary'],
    },
    pricing: [
      tier('Starter', '$25', '/mo', '1 workspace, up to 5 teammates.'),
      tier('Growth', '$89', '/mo', 'Unlimited teammates, alert rules, exec summaries.', true),
      tier('Enterprise', 'Custom', '', 'SSO, dedicated support, custom data connectors.'),
    ],
    testimonials: [
      { quote: `${brand} replaced four separate dashboards our team used to check every morning.`, name: 'Ava Chen', role: 'COO' },
      { quote: 'The alert rules caught a metric dip a full day before we would have noticed.', name: 'Diego Ramirez', role: 'Operations Lead' },
      { quote: 'Our Monday stand-up is ten minutes shorter now.', name: 'Sofia Müller', role: 'Team Lead' },
    ],
    faq: [
      { q: 'Can I connect our existing tools?', a: 'Yes, via native connectors or a direct API for custom sources.' },
      { q: 'How many teams can share one workspace?', a: 'As many as you need — each team gets its own metric feed within the same view.' },
      { q: 'Can I schedule the exec summary?', a: 'Yes, it can be delivered automatically every week to any distribution list.' },
    ],
    cta: {
      headline: `Stop checking four tabs to know how the week is going`,
      subtext: `${brand} is set up for your team in about twelve minutes.`,
      button: 'Get started',
    },
  };
}

const BUILDERS: Record<BuilderCategory, (ctx: Ctx) => Omit<SiteContent, 'category' | 'brand' | 'typography'>> = {
  finance: financeContent,
  analytics: analyticsContent,
  ecommerce: ecommerceContent,
  education: educationContent,
  creator: creatorContent,
  agency: agencyContent,
  portfolio: portfolioContent,
  internal_tool: internalToolContent,
  saas: saasContent,
  ai: aiContent,
  dashboard: dashboardContent,
};

// ── Typography pairing — follows the Design Brief's visual style so the
// generated preview's type choice actually reflects the chosen direction. ──

function typographyForStyle(visualStyle?: string): string {
  switch (visualStyle) {
    case 'Luxury Dark':
      return 'Playfair Display · Headlines 48–72px / 600 · Body: Inter 16px / 400';
    case 'Apple Clean':
      return 'SF Pro Display · Headlines 44–64px / 600 · Body: Inter 16px / 400';
    case 'Linear SaaS':
      return 'Inter · Headlines 40–56px / 650 · Body: Inter 15px / 400 · Code: JetBrains Mono';
    case 'Futuristic Glass':
      return 'Space Grotesk · Headlines 46–68px / 600 · Body: Inter 16px / 400';
    default:
      return 'Inter · Headlines 44–64px / 650 · Body: Inter 16px / 400';
  }
}

// ── Brand swatches follow the resolved color direction, not the category —
// the "Brand system" section should always reflect what the user actually
// picked in the Design Brief. ──

function brandSwatchesForDirection(colorDirection?: string): Array<{ hex: string; label: string }> {
  const p = paletteForDirection(colorDirection);
  return [
    { hex: '#0A0A0A', label: 'Canvas' },
    { hex: p.accent, label: 'Primary accent' },
    { hex: p.accent2, label: 'Secondary accent' },
    { hex: '#34D399', label: 'Success' },
  ];
}

export function generateSiteContent(
  prompt: string, brief?: DesignBriefAnswers | null, brandOverride?: string | null,
): SiteContent {
  const category = detectCategory(prompt);
  const retail = detectRetailFlavor(prompt);
  const brand = (brandOverride || '').trim() || brandNameFromPrompt(prompt);
  const body = BUILDERS[category]({ brand, retail });
  return {
    category,
    brandName: brand,
    brand: brandSwatchesForDirection(brief?.colorDirection),
    typography: typographyForStyle(brief?.visualStyle),
    ...body,
  };
}
