export interface WikiBlock {
  type: 'p' | 'bullets' | 'steps';
  keys: string[];
}

export interface WikiSection {
  id: string;
  titleKey: string;
  blocks: WikiBlock[];
  related: string[];
}

export const WIKI_SECTIONS: WikiSection[] = [
  {
    id: 'overview',
    titleKey: 'help.wiki.overview.title',
    blocks: [
      { type: 'p', keys: ['help.wiki.overview.p0'] },
      { type: 'p', keys: ['help.wiki.overview.p1'] },
      { type: 'p', keys: ['help.wiki.overview.p2'] },
    ],
    related: ['getting-started', 'data'],
  },
  {
    id: 'getting-started',
    titleKey: 'help.wiki.getting-started.title',
    blocks: [
      { type: 'p', keys: ['help.wiki.getting-started.p0'] },
      { type: 'steps', keys: ['help.wiki.getting-started.s0', 'help.wiki.getting-started.s1', 'help.wiki.getting-started.s2'] },
      { type: 'p', keys: ['help.wiki.getting-started.p1'] },
    ],
    related: ['overview', 'interface'],
  },
  {
    id: 'interface',
    titleKey: 'help.wiki.interface.title',
    blocks: [
      { type: 'p', keys: ['help.wiki.interface.p0'] },
      { type: 'p', keys: ['help.wiki.interface.p1'] },
      { type: 'p', keys: ['help.wiki.interface.p2'] },
      { type: 'bullets', keys: ['help.wiki.interface.b0', 'help.wiki.interface.b1'] },
    ],
    related: ['workspace', 'tab-reorder', 'settings'],
  },
  {
    id: 'workspace',
    titleKey: 'help.wiki.workspace.title',
    blocks: [
      { type: 'p', keys: ['help.wiki.workspace.p0'] },
      { type: 'p', keys: ['help.wiki.workspace.p1'] },
      { type: 'steps', keys: ['help.wiki.workspace.s0', 'help.wiki.workspace.s1'] },
    ],
    related: ['interface', 'account', 'cloud'],
  },
  {
    id: 'gallery',
    titleKey: 'help.wiki.gallery.title',
    blocks: [
      { type: 'p', keys: ['help.wiki.gallery.p0'] },
      { type: 'p', keys: ['help.wiki.gallery.p1'] },
      { type: 'p', keys: ['help.wiki.gallery.p2'] },
      { type: 'bullets', keys: ['help.wiki.gallery.b0', 'help.wiki.gallery.b1', 'help.wiki.gallery.b2'] },
      { type: 'p', keys: ['help.wiki.gallery.p3'] },
    ],
    related: ['product-detail', 'products', 'dashboard'],
  },
  {
    id: 'categories',
    titleKey: 'help.wiki.categories.title',
    blocks: [
      { type: 'p', keys: ['help.wiki.categories.p0'] },
      { type: 'p', keys: ['help.wiki.categories.p1'] },
      { type: 'p', keys: ['help.wiki.categories.p2'] },
    ],
    related: ['products'],
  },
  {
    id: 'quickadjust',
    titleKey: 'help.wiki.quickadjust.title',
    blocks: [
      { type: 'p', keys: ['help.wiki.quickadjust.p0'] },
      { type: 'p', keys: ['help.wiki.quickadjust.p1'] },
      { type: 'p', keys: ['help.wiki.quickadjust.p2'] },
      { type: 'p', keys: ['help.wiki.quickadjust.p3'] },
      { type: 'bullets', keys: ['help.wiki.quickadjust.b0', 'help.wiki.quickadjust.b1', 'help.wiki.quickadjust.b2', 'help.wiki.quickadjust.b3'] },
    ],
    related: ['batches', 'logs', 'providers'],
  },
  {
    id: 'dashboard',
    titleKey: 'help.wiki.dashboard.title',
    blocks: [
      { type: 'p', keys: ['help.wiki.dashboard.p0'] },
      { type: 'p', keys: ['help.wiki.dashboard.p1'] },
      { type: 'bullets', keys: ['help.wiki.dashboard.b0', 'help.wiki.dashboard.b1', 'help.wiki.dashboard.b2', 'help.wiki.dashboard.b3'] },
      { type: 'p', keys: ['help.wiki.dashboard.p2'] },
    ],
    related: ['cost', 'gallery'],
  },
  {
    id: 'used',
    titleKey: 'help.wiki.used.title',
    blocks: [
      { type: 'p', keys: ['help.wiki.used.p0'] },
      { type: 'p', keys: ['help.wiki.used.p1'] },
    ],
    related: ['logs'],
  },
  {
    id: 'products',
    titleKey: 'help.wiki.products.title',
    blocks: [
      { type: 'p', keys: ['help.wiki.products.p0'] },
      { type: 'p', keys: ['help.wiki.products.p1'] },
      { type: 'p', keys: ['help.wiki.products.p2'] },
      { type: 'p', keys: ['help.wiki.products.p3'] },
    ],
    related: ['categories', 'batches'],
  },
  {
    id: 'batches',
    titleKey: 'help.wiki.batches.title',
    blocks: [
      { type: 'p', keys: ['help.wiki.batches.p0'] },
      { type: 'p', keys: ['help.wiki.batches.p1'] },
      { type: 'p', keys: ['help.wiki.batches.p2'] },
      { type: 'p', keys: ['help.wiki.batches.p3'] },
      { type: 'p', keys: ['help.wiki.batches.p4'] },
    ],
    related: ['cost', 'quickadjust', 'providers'],
  },
  {
    id: 'providers',
    titleKey: 'help.wiki.providers.title',
    blocks: [
      { type: 'p', keys: ['help.wiki.providers.p0'] },
      { type: 'p', keys: ['help.wiki.providers.p1'] },
      { type: 'bullets', keys: ['help.wiki.providers.b0', 'help.wiki.providers.b1', 'help.wiki.providers.b2'] },
    ],
    related: ['batches', 'quickadjust', 'txhistory'],
  },
  {
    id: 'txhistory',
    titleKey: 'help.wiki.txhistory.title',
    blocks: [
      { type: 'p', keys: ['help.wiki.txhistory.p0'] },
      { type: 'p', keys: ['help.wiki.txhistory.p1'] },
      { type: 'bullets', keys: ['help.wiki.txhistory.b0', 'help.wiki.txhistory.b1', 'help.wiki.txhistory.b2'] },
      { type: 'p', keys: ['help.wiki.txhistory.p2'] },
    ],
    related: ['logs', 'reports', 'providers'],
  },
  {
    id: 'reports',
    titleKey: 'help.wiki.reports.title',
    blocks: [
      { type: 'p', keys: ['help.wiki.reports.p0'] },
      { type: 'p', keys: ['help.wiki.reports.p1'] },
      { type: 'bullets', keys: ['help.wiki.reports.b0', 'help.wiki.reports.b1', 'help.wiki.reports.b2'] },
      { type: 'p', keys: ['help.wiki.reports.p2'] },
      { type: 'steps', keys: ['help.wiki.reports.s0', 'help.wiki.reports.s1', 'help.wiki.reports.s2'] },
    ],
    related: ['txhistory', 'print', 'cost'],
  },
  {
    id: 'print',
    titleKey: 'help.wiki.print.title',
    blocks: [
      { type: 'p', keys: ['help.wiki.print.p0'] },
      { type: 'steps', keys: ['help.wiki.print.s0', 'help.wiki.print.s1', 'help.wiki.print.s2'] },
    ],
    related: ['reports'],
  },
  {
    id: 'themes',
    titleKey: 'help.wiki.themes.title',
    blocks: [
      { type: 'p', keys: ['help.wiki.themes.p0'] },
      { type: 'p', keys: ['help.wiki.themes.p1'] },
      { type: 'bullets', keys: ['help.wiki.themes.b0', 'help.wiki.themes.b1', 'help.wiki.themes.b2', 'help.wiki.themes.b3', 'help.wiki.themes.b4', 'help.wiki.themes.b5', 'help.wiki.themes.b6', 'help.wiki.themes.b7'] },
      { type: 'p', keys: ['help.wiki.themes.p2'] },
    ],
    related: ['settings'],
  },
  {
    id: 'logs',
    titleKey: 'help.wiki.logs.title',
    blocks: [
      { type: 'p', keys: ['help.wiki.logs.p0'] },
      { type: 'p', keys: ['help.wiki.logs.p1'] },
      { type: 'p', keys: ['help.wiki.logs.p2'] },
    ],
    related: ['quickadjust', 'used'],
  },
  {
    id: 'product-detail',
    titleKey: 'help.wiki.product-detail.title',
    blocks: [
      { type: 'p', keys: ['help.wiki.product-detail.p0'] },
      { type: 'bullets', keys: ['help.wiki.product-detail.b0', 'help.wiki.product-detail.b1'] },
    ],
    related: ['gallery', 'products'],
  },
  {
    id: 'settings',
    titleKey: 'help.wiki.settings.title',
    blocks: [
      { type: 'p', keys: ['help.wiki.settings.p0'] },
      { type: 'p', keys: ['help.wiki.settings.p1'] },
      { type: 'p', keys: ['help.wiki.settings.p2'] },
    ],
    related: ['interface', 'tab-reorder', 'sync', 'alerts'],
  },
  {
    id: 'tab-reorder',
    titleKey: 'help.wiki.tab-reorder.title',
    blocks: [
      { type: 'p', keys: ['help.wiki.tab-reorder.p0'] },
      { type: 'p', keys: ['help.wiki.tab-reorder.p1'] },
    ],
    related: ['interface', 'settings'],
  },
  {
    id: 'account',
    titleKey: 'help.wiki.account.title',
    blocks: [
      { type: 'p', keys: ['help.wiki.account.p0'] },
      { type: 'p', keys: ['help.wiki.account.p1'] },
      { type: 'steps', keys: ['help.wiki.account.s0', 'help.wiki.account.s1'] },
    ],
    related: ['cloud', 'sync', 'teams'],
  },
  {
    id: 'cloud',
    titleKey: 'help.wiki.cloud.title',
    blocks: [
      { type: 'p', keys: ['help.wiki.cloud.p0'] },
      { type: 'steps', keys: ['help.wiki.cloud.s0', 'help.wiki.cloud.s1', 'help.wiki.cloud.s2'] },
      { type: 'p', keys: ['help.wiki.cloud.p1'] },
    ],
    related: ['account', 'teams', 'sync'],
  },
  {
    id: 'teams',
    titleKey: 'help.wiki.teams.title',
    blocks: [
      { type: 'p', keys: ['help.wiki.teams.p0'] },
      { type: 'p', keys: ['help.wiki.teams.p1'] },
      { type: 'steps', keys: ['help.wiki.teams.s0', 'help.wiki.teams.s1', 'help.wiki.teams.s2', 'help.wiki.teams.s3'] },
    ],
    related: ['account', 'cloud', 'sync'],
  },
  {
    id: 'sync',
    titleKey: 'help.wiki.sync.title',
    blocks: [
      { type: 'p', keys: ['help.wiki.sync.p0'] },
      { type: 'p', keys: ['help.wiki.sync.p1'] },
      { type: 'steps', keys: ['help.wiki.sync.s0', 'help.wiki.sync.s1', 'help.wiki.sync.s2'] },
    ],
    related: ['account', 'cloud', 'teams'],
  },
  {
    id: 'alerts',
    titleKey: 'help.wiki.alerts.title',
    blocks: [
      { type: 'p', keys: ['help.wiki.alerts.p0'] },
      { type: 'p', keys: ['help.wiki.alerts.p1'] },
      { type: 'bullets', keys: ['help.wiki.alerts.b0', 'help.wiki.alerts.b1', 'help.wiki.alerts.b2'] },
    ],
    related: ['settings', 'dashboard'],
  },
  {
    id: 'devices',
    titleKey: 'help.wiki.devices.title',
    blocks: [
      { type: 'p', keys: ['help.wiki.devices.p0'] },
      { type: 'p', keys: ['help.wiki.devices.p1'] },
      { type: 'bullets', keys: ['help.wiki.devices.b0', 'help.wiki.devices.b1', 'help.wiki.devices.b2'] },
    ],
    related: ['workspace', 'cloud', 'sync'],
  },
  {
    id: 'cost',
    titleKey: 'help.wiki.cost.title',
    blocks: [
      { type: 'p', keys: ['help.wiki.cost.p0'] },
      { type: 'p', keys: ['help.wiki.cost.p1'] },
      { type: 'p', keys: ['help.wiki.cost.p2'] },
    ],
    related: ['batches', 'dashboard'],
  },
  {
    id: 'data',
    titleKey: 'help.wiki.data.title',
    blocks: [
      { type: 'p', keys: ['help.wiki.data.p0'] },
      { type: 'p', keys: ['help.wiki.data.p1'] },
      { type: 'p', keys: ['help.wiki.data.p2'] },
    ],
    related: ['overview', 'getting-started'],
  },
  {
    id: 'glossary',
    titleKey: 'help.wiki.glossary.title',
    blocks: [
      { type: 'p', keys: ['help.wiki.glossary.p0'] },
      {
        type: 'bullets',
        keys: [
          'help.wiki.glossary.b0',
          'help.wiki.glossary.b1',
          'help.wiki.glossary.b2',
          'help.wiki.glossary.b3',
          'help.wiki.glossary.b4',
          'help.wiki.glossary.b5',
          'help.wiki.glossary.b6',
          'help.wiki.glossary.b7',
          'help.wiki.glossary.b8',
          'help.wiki.glossary.b9',
          'help.wiki.glossary.b10',
          'help.wiki.glossary.b11',
          'help.wiki.glossary.b12',
          'help.wiki.glossary.b13',
          'help.wiki.glossary.b14',
          'help.wiki.glossary.b15',
          'help.wiki.glossary.b16',
          'help.wiki.glossary.b17',
          'help.wiki.glossary.b18',
          'help.wiki.glossary.b19',
        ],
      },
    ],
    related: ['overview', 'batches', 'providers'],
  },
];

export function getWikiSection(id: string): WikiSection | null {
  return WIKI_SECTIONS.find((s) => s.id === id) ?? null;
}
