import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Plus, Pencil, Trash2, X, Save, Tag } from 'lucide-react';
import { executeQuery, upsertCategory, deleteCategory, getCategoryTemplates, upsertCategoryTemplate, deleteCategoryTemplate } from '../../lib/db';
import { useI18n } from '../../lib/language';

interface Category {
  id: number;
  name: string;
  description: string | null;
  icon: string;
  color: string;
  product_count: number;
}

interface Template {
  id: number;
  attr_key: string;
  attr_type: string;
  is_required: boolean;
  display_order: number;
}

const EMOJI_OPTIONS = ['🍷', '🥂', '🌸', '🍾', '🫙', '🍸', '🚬', '📦', '☕', '🫒', '🧀', '🥩', '🐟', '🍞', '🍫', '🎁', '🧹', '🔧'];

const COLOR_OPTIONS = [
  '#dc2626', '#ea580c', '#f59e0b', '#eab308', '#84cc16', '#22c55e',
  '#14b8a6', '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1', '#8b5cf6',
  '#a855f7', '#d946ef', '#ec4899', '#f43f5e', '#78716c', '#5b6abf',
];

export default function CategoryManager() {
  const { t } = useI18n();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);

  const [editingCategory, setEditingCategory] = useState(false);
  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formIcon, setFormIcon] = useState('📋');
  const [formColor, setFormColor] = useState('#5b6abf');

  const [showNewTemplate, setShowNewTemplate] = useState(false);
  const [tplFormKey, setTplFormKey] = useState('');
  const [tplFormType, setTplFormType] = useState('string');
  const [tplFormRequired, setTplFormRequired] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
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

  const fetchTemplates = useCallback(async (categoryId: number) => {
    try {
      const result = await getCategoryTemplates(categoryId);
      setTemplates(result.map((r) => ({
        id: r.id as number,
        attr_key: r.attr_key as string,
        attr_type: r.attr_type as string,
        is_required: r.is_required as boolean,
        display_order: r.display_order as number,
      })));
    } catch (err) {
      setError(String(err));
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => {
    if (selectedCategory) fetchTemplates(selectedCategory.id);
  }, [selectedCategory, fetchTemplates]);

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

  const saveTemplate = async () => {
    if (!tplFormKey.trim() || !selectedCategory) return;
    try {
      await upsertCategoryTemplate(
        selectedCategory.id,
        tplFormKey,
        tplFormType,
        tplFormRequired,
        Math.max(0, ...templates.map((t) => t.display_order)) + 1
      );
      setShowNewTemplate(false);
      setTplFormKey('');
      setTplFormType('string');
      setTplFormRequired(false);
      await fetchTemplates(selectedCategory.id);
    } catch (err) {
      setError(String(err));
    }
  };

  const handleDeleteTemplate = async (templateId: number) => {
    if (!selectedCategory) return;
    try {
      await deleteCategoryTemplate(templateId);
      await fetchTemplates(selectedCategory.id);
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

  return (
    <div className="h-full flex overflow-hidden">
      {/* Category list */}
      <div className="w-[300px] border-r border-border bg-bg-secondary flex flex-col shrink-0">
        <div className="px-3 py-2 border-b border-border flex items-center justify-between">
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
              className={`w-full text-left px-3 py-3 transition-colors ${
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
              </div>
            </button>
          ))}
          {categories.length === 0 && (
            <div className="p-4 text-xs text-text-secondary text-center">{t('cats.noCategories')}</div>
          )}
        </div>
      </div>

      {/* Detail / Edit panel */}
      <div className="flex-1 overflow-y-auto">
        {editingCategory ? (
          <div className="p-6 max-w-[500px]">
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
          <div className="p-6 space-y-6">
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

            {/* Attribute templates */}
            <div className="bg-bg-secondary border border-border rounded-lg">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-text-primary">{t('cats.templates')}</h3>
                  <p className="text-[10px] text-text-secondary">{t('cats.templatesSubtitle')}</p>
                </div>
                <button
                  onClick={() => setShowNewTemplate(true)}
                  className="flex items-center gap-1 px-2 py-1 bg-bg-tertiary hover:bg-bg-hover border border-border rounded-md text-[10px] text-text-secondary transition-colors"
                >
                  <Plus size={10} /> {t('common.add')}
                </button>
              </div>
              <div className="divide-y divide-border">
                {templates.map((tpl) => (
                  <div key={tpl.id} className="px-4 py-2.5 flex items-center gap-3">
                    <Tag size={12} className="text-accent" />
                    <span className="text-xs font-medium text-text-primary">{tpl.attr_key}</span>
                    <span className="text-[10px] text-text-secondary px-1.5 py-0.5 bg-bg-primary border border-border rounded">{tpl.attr_type}</span>
                    {tpl.is_required && <span className="text-[10px] text-warning font-semibold">{t('cats.required')}</span>}
                    <span className="text-[10px] text-text-secondary ml-auto">{t('cats.templateOrder', { count: tpl.display_order })}</span>
                    <button onClick={() => handleDeleteTemplate(tpl.id)} className="text-text-secondary hover:text-error transition-colors">
                      <Trash2 size={10} />
                    </button>
                  </div>
                ))}
                {showNewTemplate && (
                  <div className="px-4 py-2.5 flex items-center gap-3 bg-accent/5">
                    <Tag size={12} className="text-accent" />
                    <input value={tplFormKey} onChange={(e) => setTplFormKey(e.target.value)} placeholder={t('cats.ph.attributeName')} className="w-32 px-2 py-1 bg-bg-primary border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent" autoFocus />
                    <select value={tplFormType} onChange={(e) => setTplFormType(e.target.value)} className="px-2 py-1 bg-bg-primary border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent">
                      <option value="string">{t('common.attrType.string')}</option>
                      <option value="number">{t('common.attrType.number')}</option>
                      <option value="boolean">{t('common.attrType.boolean')}</option>
                    </select>
                    <label className="flex items-center gap-1 text-[10px] text-text-secondary cursor-pointer">
                      <input type="checkbox" checked={tplFormRequired} onChange={(e) => setTplFormRequired(e.target.checked)} className="rounded border-border" />
                      {t('cats.required')}
                    </label>
                    <button onClick={saveTemplate} className="p-1 bg-accent hover:bg-accent-hover rounded text-white"><Save size={10} /></button>
                    <button onClick={() => setShowNewTemplate(false)} className="p-1 bg-bg-tertiary hover:bg-bg-hover rounded text-text-secondary"><X size={10} /></button>
                  </div>
                )}
                {templates.length === 0 && !showNewTemplate && (
                  <div className="p-4 text-xs text-text-secondary text-center">{t('cats.noTemplates')}</div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-text-secondary text-sm">
            {t('cats.selectCategory')}
          </div>
        )}
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
