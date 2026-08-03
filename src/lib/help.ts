export interface HelpTopic {
  id: string;
  keywords: string[];
  related: string[];
}

export const HELP_TOPICS: HelpTopic[] = [
  {
    id: 'canvas',
    keywords: ['canvas', 'flow', 'node', 'table node', 'filter node', 'output node', 'connect', 'diagram', 'layout'],
    related: ['presets', 'sidebar'],
  },
  {
    id: 'query',
    keywords: ['query', 'sql', 'editor', 'run', 'sqlite', 'select', 'result'],
    related: ['sidebar', 'presets'],
  },
  {
    id: 'presets',
    keywords: ['preset', 'save layout', 'load layout', 'save layout', 'restore'],
    related: ['canvas', 'query'],
  },
  {
    id: 'sidebar',
    keywords: ['sidebar', 'schema', 'table', 'tables', 'refresh schema', 'column'],
    related: ['canvas', 'query'],
  },
  {
    id: 'quickuse',
    keywords: ['quick use', 'use product', 'search product', 'record usage', 'find product', 'usage'],
    related: ['quickadjust', 'dashboard'],
  },
  {
    id: 'quickadjust',
    keywords: ['quick adjust', 'stock in', 'stock out', 'purchase', 'spoilage', 'adjust quantity', 'transaction'],
    related: ['batches', 'logs'],
  },
  {
    id: 'batches',
    keywords: ['batch', 'batch number', 'supplier', 'unit cost', 'cost price', 'purchase date', 'arrive'],
    related: ['quickadjust', 'logs'],
  },
  {
    id: 'products',
    keywords: ['product', 'add product', 'edit product', 'delete product', 'attribute', 'unit conversion', 'reorder threshold', 'sku'],
    related: ['categories', 'batches'],
  },
  {
    id: 'categories',
    keywords: ['category', 'add category', 'organize', 'group products'],
    related: ['products'],
  },
  {
    id: 'logs',
    keywords: ['log', 'logs', 'inventory log', 'transaction history', 'filter log'],
    related: ['quickadjust', 'used'],
  },
  {
    id: 'used',
    keywords: ['use history', 'history', 'undo', 'undo usage'],
    related: ['logs', 'quickuse'],
  },
  {
    id: 'gallery',
    keywords: ['gallery', 'browse', 'product list', 'all products'],
    related: ['detail', 'quickuse'],
  },
  {
    id: 'detail',
    keywords: ['detail', 'product detail', 'notes', 'calendar', 'clients', 'notifications', 'report', 'tabs'],
    related: ['gallery', 'products'],
  },
  {
    id: 'dashboard',
    keywords: ['dashboard', 'stats', 'summary', 'low stock', 'recent activity', 'inventory value'],
    related: ['pie', 'quickuse'],
  },
  {
    id: 'pie',
    keywords: ['pie', 'chart', 'spending', 'value chart', 'history chart'],
    related: ['dashboard', 'detail'],
  },
  {
    id: 'settings',
    keywords: ['settings', 'theme', 'dark', 'light', 'language', 'startup', 'limit', 'reset'],
    related: ['tabs', 'query'],
  },
  {
    id: 'tabs',
    keywords: ['tab', 'reorder', 'tab order', 'drag', 'organize tabs'],
    related: ['settings'],
  },
  {
    id: 'cost',
    keywords: ['cost', 'price', 'how much', 'unit price', 'pricing'],
    related: ['batches', 'detail'],
  },
];

export function getTopic(id: string): HelpTopic | null {
  return HELP_TOPICS.find((topic) => topic.id === id) ?? null;
}

export function allTopics(): HelpTopic[] {
  return HELP_TOPICS;
}

export function matchHelp(query: string): HelpTopic | null {
  const normalized = query.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized) return null;

  let best: HelpTopic | null = null;
  let bestScore = 0;

  for (const topic of HELP_TOPICS) {
    let score = 0;
    for (const keyword of topic.keywords) {
      if (normalized.includes(keyword)) score += keyword.length;
    }
    if (score > bestScore) {
      bestScore = score;
      best = topic;
    }
  }

  return bestScore >= 3 ? best : null;
}
