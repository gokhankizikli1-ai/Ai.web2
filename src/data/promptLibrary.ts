import type { PromptItem } from '@/types';

export const promptLibrary: PromptItem[] = [
  // Startup
  { id: 'p1', category: 'Startup', title: 'Business Model Canvas', content: 'Help me create a Business Model Canvas for a startup that ' },
  { id: 'p2', category: 'Startup', title: 'Pitch Deck Outline', content: 'Create a compelling pitch deck outline for a startup. Include key slides and talking points.' },
  { id: 'p3', category: 'Startup', title: 'Go-to-Market Strategy', content: 'Outline a go-to-market strategy for a new SaaS product targeting enterprise customers.' },
  { id: 'p4', category: 'Startup', title: 'Investor Email', content: 'Write a concise, professional cold email to a seed-stage investor introducing my startup.' },
  { id: 'p5', category: 'Startup', title: 'Competitive Analysis', content: 'Help me perform a competitive analysis. Guide me through the framework step by step.' },
  { id: 'p6', category: 'Startup', title: 'User Persona', content: 'Create a detailed user persona for a B2B SaaS product. Include demographics, pain points, and goals.' },

  // Study
  { id: 'p7', category: 'Study', title: 'Explain Like I\'m 5', content: 'Explain this concept to me like I\'m 5 years old: ' },
  { id: 'p8', category: 'Study', title: 'Study Notes', content: 'Convert this information into well-organized study notes with key terms and definitions: ' },
  { id: 'p9', category: 'Study', title: 'Flashcards', content: 'Create a set of flashcards (Q&A format) for the following topic: ' },
  { id: 'p10', category: 'Study', title: 'Exam Prep', content: 'Create a practice exam with 10 questions (multiple choice and short answer) about: ' },
  { id: 'p11', category: 'Study', title: 'Summary', content: 'Provide a concise summary of the key points from this material: ' },
  { id: 'p12', category: 'Study', title: 'Analogy', content: 'Help me understand this concept by providing a real-world analogy: ' },

  // Coding
  { id: 'p13', category: 'Coding', title: 'Debug Code', content: 'Debug this code for me. Explain what the issue is and provide a fix:\n```\n\n```' },
  { id: 'p14', category: 'Coding', title: 'Code Review', content: 'Review this code for best practices, performance, and potential bugs: ' },
  { id: 'p15', category: 'Coding', title: 'Refactor', content: 'Refactor this code to be cleaner, more readable, and maintainable: ' },
  { id: 'p16', category: 'Coding', title: 'Write Tests', content: 'Write comprehensive unit tests for the following function: ' },
  { id: 'p17', category: 'Coding', title: 'Explain Algorithm', content: 'Explain this algorithm step-by-step, including time and space complexity: ' },
  { id: 'p18', category: 'Coding', title: 'System Design', content: 'Help me design a system architecture for: ' },

  // Marketing
  { id: 'p19', category: 'Marketing', title: 'Social Media Post', content: 'Write an engaging social media post about: ' },
  { id: 'p20', category: 'Marketing', title: 'Email Campaign', content: 'Write a marketing email campaign sequence (3 emails) for: ' },
  { id: 'p21', category: 'Marketing', title: 'SEO Keywords', content: 'Generate a list of SEO keywords and content ideas for: ' },
  { id: 'p22', category: 'Marketing', title: 'Brand Voice Guide', content: 'Create a brand voice guide with tone, vocabulary, and example copy for: ' },
  { id: 'p23', category: 'Marketing', title: 'Landing Page Copy', content: 'Write high-converting landing page copy (headline, subhead, features, CTA) for: ' },
  { id: 'p24', category: 'Marketing', title: 'Ad Copy', content: 'Write 3 variations of ad copy for: ' },

  // Finance
  { id: 'p25', category: 'Finance', title: 'Budget Plan', content: 'Help me create a monthly budget plan with categories and allocation strategy.' },
  { id: 'p26', category: 'Finance', title: 'Financial Analysis', content: 'Analyze these financial metrics and provide insights: ' },
  { id: 'p27', category: 'Finance', title: 'Investment Strategy', content: 'Explain different investment strategies for someone with a moderate risk tolerance.' },
  { id: 'p28', category: 'Finance', title: 'Startup Valuation', content: 'Explain startup valuation methods (DCF, comparables, Berkus) in simple terms.' },
  { id: 'p29', category: 'Finance', title: 'Tax Optimization', content: 'What are common tax optimization strategies for freelancers and small business owners?' },
  { id: 'p30', category: 'Finance', title: 'Cash Flow Forecast', content: 'Help me build a 12-month cash flow forecast. Ask me the necessary questions.' },

  // Productivity
  { id: 'p31', category: 'Productivity', title: 'Daily Plan', content: 'Help me plan a productive day. I need to accomplish these tasks: ' },
  { id: 'p32', category: 'Productivity', title: 'Meeting Notes', content: 'Convert these rough meeting notes into a structured summary with action items: ' },
  { id: 'p33', category: 'Productivity', title: 'Email Draft', content: 'Draft a professional email about: ' },
  { id: 'p34', category: 'Productivity', title: 'Project Plan', content: 'Create a project plan with milestones, deadlines, and deliverables for: ' },
  { id: 'p35', category: 'Productivity', title: 'Habit Tracker', content: 'Design a weekly habit tracking system focused on: ' },
  { id: 'p36', category: 'Productivity', title: 'Decision Matrix', content: 'Help me make a decision using a pros/cons framework. Here are my options: ' },
];
