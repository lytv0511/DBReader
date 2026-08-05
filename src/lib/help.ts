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
    id: 'quickadjust',
    keywords: ['quick adjust', 'stock in', 'stock out', 'purchase', 'spoilage', 'adjust quantity', 'transaction', 'adjust date', 'adjust provider', 'batch number'],
    related: ['batches', 'logs', 'providers'],
  },
  {
    id: 'batches',
    keywords: ['batch', 'batch number', 'supplier', 'unit cost', 'cost price', 'purchase date', 'arrive', 'batch status', 'edit batch'],
    related: ['quickadjust', 'logs', 'providers'],
  },
  {
    id: 'products',
    keywords: ['product', 'add product', 'edit product', 'delete product', 'attribute', 'unit conversion', 'reorder threshold', 'sku', 'base unit'],
    related: ['categories', 'batches', 'gallery'],
  },
  {
    id: 'categories',
    keywords: ['category', 'add category', 'organize', 'group products', 'attribute template', 'color', 'icon'],
    related: ['products'],
  },
  {
    id: 'logs',
    keywords: ['log', 'logs', 'inventory log', 'transaction history', 'filter log', 'delete log', 'edit notes'],
    related: ['quickadjust', 'used', 'txhistory'],
  },
  {
    id: 'used',
    keywords: ['use history', 'history', 'undo', 'undo usage', 'restore stock'],
    related: ['logs', 'txhistory'],
  },
  {
    id: 'gallery',
    keywords: ['gallery', 'browse', 'product list', 'all products', 'stock filter', 'out of stock', 'low stock', 'enough stock', 'filter products'],
    related: ['detail', 'products'],
  },
  {
    id: 'detail',
    keywords: ['detail', 'product detail', 'notes', 'calendar', 'clients', 'notifications', 'report', 'tabs', 'reservation'],
    related: ['gallery', 'products', 'reports'],
  },
  {
    id: 'dashboard',
    keywords: ['dashboard', 'stats', 'summary', 'low stock', 'recent activity', 'inventory value', 'widget', 'click card', 'navigate'],
    related: ['pie', 'gallery', 'cost'],
  },
  {
    id: 'pie',
    keywords: ['pie', 'chart', 'spending', 'value chart', 'history chart'],
    related: ['dashboard', 'detail', 'cost'],
  },
  {
    id: 'settings',
    keywords: ['settings', 'theme', 'dark', 'light', 'language', 'startup', 'limit', 'reset', 'gradient'],
    related: ['tabs', 'query', 'themes'],
  },
  {
    id: 'tabs',
    keywords: ['tab', 'reorder', 'tab order', 'drag', 'organize tabs'],
    related: ['settings', 'interface'],
  },
  {
    id: 'cost',
    keywords: ['cost', 'price', 'how much', 'unit price', 'pricing', 'inventory value'],
    related: ['batches', 'detail', 'reports'],
  },
  {
    id: 'reports',
    keywords: ['report', 'reports', 'print report', 'transaction report', 'overall report', 'stock report', 'batch report', 'pdf report', 'product report'],
    related: ['txhistory', 'print', 'cost'],
  },
  {
    id: 'txhistory',
    keywords: ['transaction history', 'tx history', 'history of transactions', 'period', 'custom date range', 'last 7 days', 'this month'],
    related: ['logs', 'reports', 'providers'],
  },
  {
    id: 'providers',
    keywords: ['provider', 'providers', 'supplier', 'vendor', 'sihl', 'siic', 'who supplied', 'who provided'],
    related: ['batches', 'quickadjust', 'txhistory'],
  },
  {
    id: 'themes',
    keywords: ['theme', 'themes', 'gradient', 'color scheme', 'background', 'aurora', 'sunset', 'ocean', 'forest', 'candy', 'gold', 'midnight', 'lava', 'dark mode', 'light mode'],
    related: ['settings', 'interface'],
  },
  {
    id: 'print',
    keywords: ['print', 'save pdf', 'export pdf', 'print report', 'printer', 'print preview'],
    related: ['reports', 'detail'],
  },
  {
    id: 'glossary',
    keywords: ['glossary', 'terminology', 'term', 'sku', 'what is a batch', 'what is a provider', 'meaning', 'definition'],
    related: ['overview', 'batches', 'providers'],
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
