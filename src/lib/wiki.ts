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
    id: 'quickuse',
    titleKey: 'help.wiki.quickuse.title',
    blocks: [
      { type: 'p', keys: ['help.wiki.quickuse.p0'] },
      { type: 'p', keys: ['help.wiki.quickuse.p1'] },
      { type: 'p', keys: ['help.wiki.quickuse.p2'] },
      { type: 'p', keys: ['help.wiki.quickuse.p3'] },
    ],
    related: ['batches', 'quickadjust'],
  },
  {
    id: 'gallery',
    titleKey: 'help.wiki.gallery.title',
    blocks: [
      { type: 'p', keys: ['help.wiki.gallery.p0'] },
      { type: 'p', keys: ['help.wiki.gallery.p1'] },
      { type: 'p', keys: ['help.wiki.gallery.p2'] },
    ],
    related: ['product-detail', 'products'],
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
    ],
    related: ['batches', 'logs'],
  },
  {
    id: 'dashboard',
    titleKey: 'help.wiki.dashboard.title',
    blocks: [
      { type: 'p', keys: ['help.wiki.dashboard.p0'] },
      { type: 'p', keys: ['help.wiki.dashboard.p1'] },
      { type: 'bullets', keys: ['help.wiki.dashboard.b0', 'help.wiki.dashboard.b1', 'help.wiki.dashboard.b2'] },
    ],
    related: ['cost', 'quickuse'],
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
    ],
    related: ['cost', 'quickadjust'],
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
        ],
      },
    ],
    related: ['overview', 'batches'],
  },
];

export function getWikiSection(id: string): WikiSection | null {
  return WIKI_SECTIONS.find((s) => s.id === id) ?? null;
}
