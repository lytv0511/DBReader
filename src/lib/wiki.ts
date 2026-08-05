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
    related: ['canvas', 'tab-reorder', 'settings'],
  },
  {
    id: 'canvas',
    titleKey: 'help.wiki.canvas.title',
    blocks: [
      { type: 'p', keys: ['help.wiki.canvas.p0'] },
      { type: 'steps', keys: ['help.wiki.canvas.s0', 'help.wiki.canvas.s1', 'help.wiki.canvas.s2', 'help.wiki.canvas.s3', 'help.wiki.canvas.s4', 'help.wiki.canvas.s5'] },
      { type: 'p', keys: ['help.wiki.canvas.p1'] },
    ],
    related: ['query', 'interface'],
  },
  {
    id: 'query',
    titleKey: 'help.wiki.query.title',
    blocks: [
      { type: 'p', keys: ['help.wiki.query.p0'] },
      { type: 'p', keys: ['help.wiki.query.p1'] },
      { type: 'p', keys: ['help.wiki.query.p2'] },
      { type: 'p', keys: ['help.wiki.query.p3'] },
    ],
    related: ['canvas', 'interface'],
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
      { type: 'bullets', keys: ['help.wiki.quickadjust.b0', 'help.wiki.quickadjust.b1', 'help.wiki.quickadjust.b2'] },
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
    related: ['reports', 'product-detail'],
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
    related: ['settings', 'interface'],
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
      { type: 'bullets', keys: ['help.wiki.product-detail.b0', 'help.wiki.product-detail.b1', 'help.wiki.product-detail.b2', 'help.wiki.product-detail.b3', 'help.wiki.product-detail.b4', 'help.wiki.product-detail.b5'] },
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
    related: ['interface', 'tab-reorder'],
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
