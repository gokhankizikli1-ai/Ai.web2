import type { ChatSession } from '@/types';

export const placeholderChats: ChatSession[] = [
  {
    id: 'demo-1',
    title: 'Quantum Computing Explained',
    updatedAt: new Date(Date.now() - 1000 * 60 * 5),
    isDemo: true,
    messages: [
      {
        id: 'm1',
        role: 'user',
        content: 'Explain quantum computing to me like I\'m 5 years old.',
        timestamp: new Date(Date.now() - 1000 * 60 * 10),
      },
      {
        id: 'm2',
        role: 'assistant',
        content: 'Imagine a regular computer is like a light switch — it can only be ON or OFF. That\'s how it thinks: one thing at a time.\n\nA quantum computer is like a magical dimmer switch that can be ON, OFF, and everything in between — all at once! So instead of checking one path through a maze, it can explore every path simultaneously. That\'s why it can solve certain super-hard problems, like finding new medicines or predicting the weather, much faster than normal computers.',
        timestamp: new Date(Date.now() - 1000 * 60 * 5),
      },
    ],
  },
  {
    id: 'demo-2',
    title: 'React Performance Tips',
    updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 2),
    isDemo: true,
    messages: [
      {
        id: 'm3',
        role: 'user',
        content: 'What are the best performance optimization techniques for a large React application?',
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 3),
      },
      {
        id: 'm4',
        role: 'assistant',
        content: 'Here are the most impactful techniques for optimizing a large React app:\n\n1. **Code Splitting & Lazy Loading**: Use `React.lazy()` and dynamic imports to split bundles by route. This ensures users only download the code they need.\n\n2. **Memoization**: Strategic use of `React.memo`, `useMemo`, and `useCallback` prevents unnecessary re-renders. Be careful not to over-memoize — profile first.\n\n3. **Virtualization**: For long lists, use libraries like `react-window` or `react-virtualized` to render only visible items.\n\n4. **State Colocation**: Keep state as close to where it\'s used as possible. Avoid lifting state unnecessarily high in the tree.\n\n5. **Optimize Re-renders**: Use the React DevTools Profiler to identify expensive renders. Look for components that render often but with the same props.',
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2),
      },
    ],
  },
  {
    id: 'demo-3',
    title: 'Creative Writing Prompts',
    updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24),
    isDemo: true,
    messages: [
      {
        id: 'm5',
        role: 'user',
        content: 'Give me 3 creative writing prompts for a sci-fi short story.',
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 25),
      },
      {
        id: 'm6',
        role: 'assistant',
        content: 'Here are three prompts to spark your imagination:\n\n**1. The Memory Merchant**\nIn a world where memories can be extracted and sold, a black-market dealer discovers a memory that doesn\'t belong to any living person — it\'s from the future.\n\n**2. The Last Lighthouse**\nEarth has been abandoned, but one automated lighthouse on a remote island continues to send signals into space. A passing alien vessel picks up the signal and believes it\'s an invitation.\n\n**3. Symbiotic Silence**\nHumanity has evolved to communicate exclusively through shared dreams. One person is born unable to dream, making them the only truly "private" individual in existence.',
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24),
      },
    ],
  },
  {
    id: 'demo-4',
    title: 'Marketing Strategy Help',
    updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 48),
    isDemo: true,
    messages: [
      {
        id: 'm7',
        role: 'user',
        content: 'How do I create a go-to-market strategy for a B2B SaaS product?',
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 50),
      },
      {
        id: 'm8',
        role: 'assistant',
        content: 'A strong B2B SaaS GTM strategy requires alignment across product, sales, and marketing. Here is a framework:\n\n**1. Ideal Customer Profile (ICP)**\nDefine exactly who benefits most. Segment by industry, company size, and pain points. The tighter your ICP, the more efficient your acquisition.\n\n**2. Value Proposition & Positioning**\nArticulate the unique value. Avoid feature lists; focus on outcomes. "We reduce churn by 30%" is stronger than "We have analytics."\n\n**3. Channel Strategy**\nFor B2B, LinkedIn, content marketing, and outbound sales are usually core. Consider partnerships and integrations as distribution channels too.\n\n**4. Pricing & Packaging**\nAlign pricing with value delivered. Freemium can work for viral growth, but enterprise tiers should capture value from power users.\n\n**5. Metrics & Iteration**\nTrack CAC, LTV, payback period, and activation rate. Build feedback loops between sales and product teams.',
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 48),
      },
    ],
  },
  {
    id: 'demo-5',
    title: 'Python Data Analysis',
    updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5),
    isDemo: true,
    messages: [
      {
        id: 'm9',
        role: 'user',
        content: 'Help me clean a messy dataset in pandas. I have missing values, duplicates, and inconsistent formatting.',
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24 * 6),
      },
      {
        id: 'm10',
        role: 'assistant',
        content: `Here is a robust cleaning pipeline for your dataset:\n\n\`\`\`python\nimport pandas as pd\n\n# 1. Load and inspect\ndf = pd.read_csv('data.csv')\nprint(df.info())\nprint(df.isnull().sum())\n\n# 2. Handle duplicates\ndf = df.drop_duplicates()\n\n# 3. Handle missing values\n# Numeric: fill with median\nnum_cols = df.select_dtypes(include=['number']).columns\ndf[num_cols] = df[num_cols].fillna(df[num_cols].median())\n\n# Categorical: fill with mode or 'Unknown'\ncat_cols = df.select_dtypes(include=['object']).columns\ndf[cat_cols] = df[cat_cols].fillna('Unknown')\n\n# 4. Standardize text\ndf[cat_cols] = df[cat_cols].apply(lambda x: x.str.strip().str.lower())\n\n# 5. Fix data types\ndf['date_col'] = pd.to_datetime(df['date_col'], errors='coerce')\n\`\`\`\n\nAlways create a copy of your raw data before cleaning, and document each transformation step for reproducibility.`,
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5),
      },
    ],
  },
];
