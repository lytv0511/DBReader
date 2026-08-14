import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Plus, Pencil, Trash2, ArrowLeft, ChevronRight, Save } from 'lucide-react';
import { executeQuery, upsertCategory, deleteCategory } from '../../lib/db';
import { useI18n } from '../../lib/language';
import { isPhone } from '../../lib/platform';

interface Category {
  id: number;
  name: string;
  description: string | null;
  icon: string;
  color: string;
  product_count: number;
}

const EMOJI_OPTIONS = ['🍷', '🥂', '🌸', '🍾', '🫙', '🍸', '🚬', '📦', '☕', '🫒', '🧀', '🥩', '🐟', '🍞', '🍫', '🎁', '🧹', '🔧'];

const COLOR_OPTIONS = [
  '#dc2626', '#ea580c', '#f59e0b', '#eab308', '#84cc16', '#22c55e',
  '#14b8a6', '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1', '#8b5cf6',
  '#a855f7', '#d946ef', '#ec4899', '#f43f5e', '#78716c', '#5b6abf',
  '#b91c1c', '#c2410c', '#b45309', '#a16207', '#4d7c0f', '#15803d',
  '#0f766e', '#0e7490', '#0369a1', '#1d4ed8', '#4f46e5', '#7c3aed',
  '#9333ea', '#c026d3', '#db2777', '#be185c', '#44403c', '#3730a3',
  '#f472b6', '#2dd4bf', '#facc15', '#fb923c', '#4ade80', '#93c5fd',
  '#ffffff',
];

export default function CategoryManager({ refreshKey }: { refreshKey?: number }) {
  const { t } = useI18n();
  const mobile = isPhone();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);

  const [editingCategory, setEditingCategory] = useState(false);
  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formIcon, setFormIcon] = useState('📋');
  const [formColor, setFormColor] = useState('#5b6abf');

  const fetchData = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const result = await executeQuery(`
        SELECT
          c.id, c.name, c.description, c.icon, c.color,
          (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS product_count
        FROM categories c
        ORDER BY c.name
      `);
      setCategories(result.rows.map((r) => ({
        id: r[0] as number,
        name: r[1] as string,
        description: r[2] as string | null,
        icon: r[3] as string || '📋',
        color: r[4] as string || '#5b6abf',
        product_count: r[5] as number,
      })));
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => {
    if (refreshKey !== undefined && refreshKey > 0) fetchData(true);
  }, [refreshKey, fetchData]);

  const openNewCategory = () => {
    setEditingCategory(true);
    setFormName('');
    setFormDesc('');
    setFormIcon('📋');
    setFormColor('#5b6abf');
    setSelectedCategory(null);
  };

  const openEditCategory = (cat: Category) => {
    setSelectedCategory(cat);
    setEditingCategory(true);
    setFormName(cat.name);
    setFormDesc(cat.description || '');
    setFormIcon(cat.icon);
    setFormColor(cat.color);
  };

  const saveCategory = async () => {
    if (!formName.trim()) return;
    try {
      const id = await upsertCategory(formName, formDesc || null, formIcon, formColor);
      setEditingCategory(false);
      await fetchData();
      // Select the saved category
      setCategories((prev) => {
        const cat = prev.find((c) => c.id === id);
        if (cat) setSelectedCategory({ ...cat, name: formName, icon: formIcon, color: formColor });
        return prev;
      });
    } catch (err) {
      setError(String(err));
    }
  };

  const handleDeleteCategory = async (cat: Category) => {
    if (!confirm(t('cats.confirmDelete', { name: cat.name }))) return;
    try {
      await deleteCategory(cat.id);
      if (selectedCategory?.id === cat.id) setSelectedCategory(null);
      await fetchData();
    } catch (err) {
      setError(String(err));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-text-secondary">
        <RefreshCw size={20} className="animate-spin mr-2" />
        {t('cats.loading')}
      </div>
    );
  }

  const categoryList = (
    <div className={mobile ? 'h-full flex flex-col overflow-hidden' : 'w-full sm:w-[300px] border-b sm:border-b-0 sm:border-r border-border bg-bg-secondary flex flex-col shrink-0 max-h-[40%] sm:max-h-none'}>
      <div className="px-3 py-2 border-b border-border flex items-center justify-between shrink-0">
        <span className="text-xs font-semibold text-text-secondary uppercase tracking-wide">{t('cats.title')}</span>
        <button
          onClick={openNewCategory}
          className="p-1.5 rounded hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors"
          title={t('cats.addCategory')}
        >
          <Plus size={12} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto divide-y divide-border">
        {categories.map((cat) => (
          <button
            key={cat.id}
            onClick={() => { setSelectedCategory(cat); setEditingCategory(false); }}
            className={`w-full text-left px-3 py-4 transition-colors ${
              selectedCategory?.id === cat.id ? 'bg-accent/10' : 'hover:bg-bg-hover'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <span className="text-xl" style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.3))' }}>{cat.icon}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-text-primary truncate">{cat.name}</p>
                <p className="text-[10px] text-text-secondary">{t('cats.productCount', { count: cat.product_count })}</p>
              </div>
              <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
              {mobile && <ChevronRight size={14} className="text-text-secondary/50 shrink-0" />}
            </div>
          </button>
        ))}
        {categories.length === 0 && (
          <div className="p-4 text-xs text-text-secondary text-center">{t('cats.noCategories')}</div>
        )}
      </div>
    </div>
  );

  const detailContent = (
    <div className={mobile ? 'p-5' : 'p-6'}>
      {editingCategory ? (
        <div className="max-w-[500px]">
          <h3 className="text-sm font-bold text-text-primary mb-4">{selectedCategory ? t('cats.editCategory') : t('cats.newCategory')}</h3>
            <div className="space-y-4">
              {/* Icon picker */}
              <div>
                <label className="text-xs text-text-secondary mb-1.5 block">{t('cats.icon')}</label>
                <div className="flex gap-1.5 flex-wrap">
                  {EMOJI_OPTIONS.map((emoji) => (
                    <button
                      key={emoji}
                      onClick={() => setFormIcon(emoji)}
                      className={`w-9 h-9 rounded-lg flex items-center justify-center text-lg border transition-all ${
                        formIcon === emoji ? 'border-accent bg-accent/10 scale-110' : 'border-border hover:border-accent/50'
                      }`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>

              {/* Color picker */}
              <div>
                <label className="text-xs text-text-secondary mb-1.5 block">{t('cats.color')}</label>
                <div className="flex gap-1.5 flex-wrap">
                  {COLOR_OPTIONS.map((color) => (
                    <button
                      key={color}
                      onClick={() => setFormColor(color)}
                      className={`w-7 h-7 rounded-full border-2 transition-all ${
                        formColor === color ? 'border-white scale-110 ring-2 ring-accent' : 'border-transparent hover:scale-105'
                      }`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs text-text-secondary mb-1 block">{t('cats.name')}</label>
                <input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder={t('cats.ph.categoryName')} className="w-full px-3 py-2 bg-bg-primary border border-border rounded-md text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent" />
              </div>

              <div>
                <label className="text-xs text-text-secondary mb-1 block">{t('cats.description')} {t('common.optional')}</label>
                <textarea value={formDesc} onChange={(e) => setFormDesc(e.target.value)} rows={2} placeholder={t('cats.ph.description')} className="w-full px-3 py-2 bg-bg-primary border border-border rounded-md text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent resize-none" />
              </div>

              {/* Preview */}
              <div className="p-4 bg-bg-primary border border-border rounded-lg flex items-center gap-3">
                <span className="text-3xl">{formIcon}</span>
                <div>
                  <p className="text-sm font-bold text-text-primary">{formName || t('cats.previewName')}</p>
                  <p className="text-xs text-text-secondary">{formDesc || t('cats.noDescription')}</p>
                </div>
                <div className="ml-auto w-4 h-4 rounded-full" style={{ backgroundColor: formColor }} />
              </div>

              <div className="flex gap-2">
                <button onClick={saveCategory} className="flex items-center gap-1 px-4 py-2 bg-accent hover:bg-accent-hover rounded-md text-xs text-white transition-colors">
                  <Save size={10} /> {t('common.save')}
                </button>
                <button onClick={() => setEditingCategory(false)} className="px-4 py-2 bg-bg-tertiary hover:bg-bg-hover border border-border rounded-md text-xs text-text-secondary transition-colors">
                  {t('common.cancel')}
                </button>
              </div>
            </div>
          </div>
        ) : selectedCategory ? (
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <span className="text-3xl">{selectedCategory.icon}</span>
              <div className="flex-1">
                <h2 className="text-lg font-bold text-text-primary">{selectedCategory.name}</h2>
                <p className="text-xs text-text-secondary">{selectedCategory.description || t('cats.noDescription')} · {t('cats.productCount', { count: selectedCategory.product_count })}</p>
              </div>
              <div className="w-4 h-4 rounded-full" style={{ backgroundColor: selectedCategory.color }} />
              <button onClick={() => openEditCategory(selectedCategory)} className="p-2 rounded-lg hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors">
                <Pencil size={14} />
              </button>
              <button onClick={() => handleDeleteCategory(selectedCategory)} className="p-2 rounded-lg hover:bg-error/10 text-text-secondary hover:text-error transition-colors">
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-text-secondary text-sm">
            {t('cats.selectCategory')}
          </div>
        )}
    </div>
  );

  if (mobile && (selectedCategory || editingCategory)) {
    return (
      <div className="h-full flex flex-col overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-bg-secondary shrink-0">
          <button
            onClick={() => { setSelectedCategory(null); setEditingCategory(false); }}
            className="flex items-center justify-center w-8 h-8 bg-bg-tertiary hover:bg-bg-hover border border-border rounded-md text-text-primary transition-colors shrink-0"
            aria-label="Back"
          >
            <ArrowLeft size={16} />
          </button>
          <span className="text-sm font-semibold text-text-primary truncate">
            {editingCategory ? (selectedCategory ? t('cats.editCategory') : t('cats.newCategory')) : selectedCategory?.name}
          </span>
        </div>
        <div className="flex-1 overflow-y-auto">
          {detailContent}
        </div>
        {error && (
          <div className="fixed bottom-4 right-4 bg-error/10 border border-error/20 text-error px-4 py-2 rounded-lg text-xs shadow-lg z-50">
            {error}
            <button onClick={() => setError(null)} className="ml-2 hover:underline">{t('common.dismiss')}</button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col sm:flex-row overflow-hidden">
      {categoryList}
      {/* Detail / Edit panel */}
      <div className={`flex-1 overflow-y-auto ${mobile ? 'hidden' : ''}`}>
        {detailContent}
      </div>

      {error && (
        <div className="fixed bottom-4 right-4 bg-error/10 border border-error/20 text-error px-4 py-2 rounded-lg text-xs shadow-lg z-50">
          {error}
          <button onClick={() => setError(null)} className="ml-2 hover:underline">{t('common.dismiss')}</button>
        </div>
      )}
    </div>
  );
}
