export interface HelpTopic {
  id: string;
  keywords: string[];
  related: string[];
}

export const HELP_TOPICS: HelpTopic[] = [
  {
    id: 'workspace',
    keywords: ['workspace', 'home', 'launcher', 'start screen', 'tile', 'open tool', 'welcome screen'],
    related: ['account', 'cloud', 'devices'],
  },
  {
    id: 'quickadjust',
    keywords: ['quick adjust', 'stock in', 'stock out', 'purchase', 'spoilage', 'adjust quantity', 'transaction', 'adjust date', 'adjust provider', 'batch number', 'quick quantity'],
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
    keywords: ['log', 'logs', 'inventory log', 'activity log', 'transaction history', 'filter log', 'delete log', 'edit notes'],
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
    keywords: ['detail', 'product detail', 'history', 'notes', 'purchase history', 'usage chart', 'product tabs'],
    related: ['gallery', 'products'],
  },
  {
    id: 'dashboard',
    keywords: ['dashboard', 'stats', 'summary', 'low stock', 'recent activity', 'inventory value', 'widget', 'click card', 'navigate'],
    related: ['pie', 'gallery', 'cost'],
  },
  {
    id: 'pie',
    keywords: ['pie', 'chart', 'spending', 'value chart', 'history chart'],
    related: ['dashboard', 'cost'],
  },
  {
    id: 'settings',
    keywords: ['settings', 'theme', 'dark', 'light', 'language', 'currency', 'email alert', 'sync', 'startup', 'limit', 'tabs', 'reset', 'gradient', 'notification'],
    related: ['tabs', 'themes', 'sync'],
  },
  {
    id: 'tabs',
    keywords: ['tab', 'reorder', 'tab order', 'drag', 'organize tabs', 'enable tab', 'disable tab', 'hide tab', 'show tab', 'max six', 'taskbar'],
    related: ['settings', 'interface'],
  },
  {
    id: 'cost',
    keywords: ['cost', 'price', 'how much', 'unit price', 'pricing', 'inventory value'],
    related: ['batches', 'reports'],
  },
  {
    id: 'reports',
    keywords: ['report', 'reports', 'print report', 'activity report', 'purchase report', 'usage report', 'spoilage report', 'adjustment report', 'overall report', 'stock report', 'batch report', 'pdf report', 'product report', 'activities report'],
    related: ['txhistory', 'print', 'cost'],
  },
  {
    id: 'txhistory',
    keywords: ['transaction history', 'tx history', 'history of transactions', 'period', 'custom date range', 'last 7 days', 'this month'],
    related: ['logs', 'reports', 'providers'],
  },
  {
    id: 'providers',
    keywords: ['provider', 'providers', 'supplier', 'vendor', 'sihl', 'siic', 'who supplied', 'who provided', 'storage'],
    related: ['batches', 'quickadjust', 'txhistory'],
  },
  {
    id: 'themes',
    keywords: ['theme', 'themes', 'gradient', 'color scheme', 'background', 'aurora', 'sunset', 'ocean', 'forest', 'candy', 'gold', 'midnight', 'lava', 'dark mode', 'light mode'],
    related: ['settings'],
  },
  {
    id: 'print',
    keywords: ['print', 'save pdf', 'export pdf', 'print report', 'printer', 'print preview'],
    related: ['reports'],
  },
  {
    id: 'account',
    keywords: ['account', 'sign in', 'sign up', 'login', 'create account', 'username', 'password', 'sign out', 'session'],
    related: ['cloud', 'sync', 'teams'],
  },
  {
    id: 'cloud',
    keywords: ['cloud', 'account inventories', 'my files', 'upload', 'download', 'backup', 'cloud open', 'cloud file'],
    related: ['account', 'teams', 'sync'],
  },
  {
    id: 'teams',
    keywords: ['team', 'teams', 'create team', 'join team', 'invite code', 'member', 'owner', 'viewer', 'publish', 'collaborate', 'share inventory', 'transfer admin'],
    related: ['cloud', 'account', 'sync'],
  },
  {
    id: 'sync',
    keywords: ['sync', 'synchronize', 'sync now', 'invite code', 'join code', 'real time', 'live sync', 'same database'],
    related: ['account', 'cloud', 'teams'],
  },
  {
    id: 'alerts',
    keywords: ['alert', 'alerts', 'notification', 'notifications', 'email alert', 'smtp', 'desktop notification', 'low stock alert', 'out of stock alert', 'reminder', 'send time'],
    related: ['settings', 'dashboard'],
  },
  {
    id: 'devices',
    keywords: ['device', 'devices', 'phone', 'tablet', 'mobile', 'desktop', 'version', 'layout', 'screen', 'ipad', 'android'],
    related: ['workspace', 'cloud', 'sync'],
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
