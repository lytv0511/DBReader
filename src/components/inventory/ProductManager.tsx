import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Plus, Pencil, Trash2, X, Save, Tag } from 'lucide-react';
import { executeQuery, upsertProductAttribute, deleteCategory } from '../../lib/db';
import { useI18n } from '../../lib/language';
import { UNIT_RECS } from '../../lib/units';

interface Product {
  id: number;
  category_id: number | null;
  name: string;
  sku: string | null;
  base_unit_name: string;
  reorder_threshold: number;
  category_name: string;
}

interface Category {
  id: number;
  name: string;
}

interface ProductAttribute {
  id: number;
  product_id: number;
  attr_key: string;
  attr_value: string;
  data_type: string;
}

interface UnitConversion {
  id: number;
  product_id: number;
  unit_name: string;
  conversion_factor: number;
}

type ModalMode = 'product' | 'category' | 'attribute' | 'unit' | null;

function UnitInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const { lang } = useI18n();
  const [open, setOpen] = useState(false);
  const base = UNIT_RECS[lang] ?? UNIT_RECS.en;
  const trimmed = value.trim().toLowerCase();
  const filtered = base.filter((r) => r.toLowerCase().includes(trimmed));
  const shown = trimmed && filtered.length > 0 ? filtered : base;
  return (
    <div className="relative">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        placeholder={placeholder}
        className="w-full px-3 py-2 bg-bg-primary border border-border rounded-md text-xs text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent"
      />
      {open && (
        <div className="absolute z-10 top-full mt-1 w-full bg-bg-tertiary border border-border rounded-md shadow-xl max-h-40 overflow-y-auto">
          {shown.map((r) => (
            <button
              key={r}
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(r);
                setOpen(false);
              }}
              className={`block w-full text-left px-3 py-1.5 text-xs hover:bg-bg-hover ${
                r === value ? 'text-accent font-semibold' : 'text-text-primary'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ProductManager() {
  const { t } = useI18n();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [productAttrs, setProductAttrs] = useState<ProductAttribute[]>([]);
  const [productUnits, setProductUnits] = useState<UnitConversion[]>([]);

  // Form states
  const [formName, setFormName] = useState('');
  const [formSku, setFormSku] = useState('');
  const [formCategoryId, setFormCategoryId] = useState<number | ''>('');
  const [formUnitName, setFormUnitName] = useState('bottle');
  const [formReorderThreshold, setFormReorderThreshold] = useState('0');
  const [formCategoryName, setFormCategoryName] = useState('');
  const [formAttrKey, setFormAttrKey] = useState('');
  const [formAttrValue, setFormAttrValue] = useState('');
  const [formAttrType, setFormAttrType] = useState('string');
  const [formUnitName2, setFormUnitName2] = useState('');
  const [formConversionFactor, setFormConversionFactor] = useState('1');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [productsResult, categoriesResult] = await Promise.all([
        executeQuery(`
          SELECT p.id, p.category_id, p.name, p.sku, p.base_unit_name, p.reorder_threshold,
                 COALESCE(c.name, 'Uncategorized') AS category_name
          FROM products p
          LEFT JOIN categories c ON p.category_id = c.id
          ORDER BY c.name, p.name
        `),
        executeQuery('SELECT id, name FROM categories ORDER BY name'),
      ]);

      setProducts(productsResult.rows.map((r) => ({
        id: r[0] as number,
        category_id: r[1] as number | null,
        name: r[2] as string,
        sku: r[3] as string | null,
        base_unit_name: r[4] as string,
        reorder_threshold: r[5] as number,
        category_name: r[6] as string,
      })));

      setCategories(categoriesResult.rows.map((r) => ({
        id: r[0] as number,
        name: r[1] as string,
      })));
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchProductDetails = useCallback(async (productId: number) => {
    try {
      const [attrsResult, unitsResult] = await Promise.all([
        executeQuery(`SELECT id, product_id, attr_key, attr_value, data_type FROM product_attributes WHERE product_id = ${productId}`),
        executeQuery(`SELECT id, product_id, unit_name, conversion_factor FROM unit_conversions WHERE product_id = ${productId}`),
      ]);
      setProductAttrs(attrsResult.rows.map((r) => ({
        id: r[0] as number, product_id: r[1] as number, attr_key: r[2] as string, attr_value: r[3] as string, data_type: r[4] as string,
      })));
      setProductUnits(unitsResult.rows.map((r) => ({
        id: r[0] as number, product_id: r[1] as number, unit_name: r[2] as string, conversion_factor: r[3] as number,
      })));
    } catch (err) {
      setError(String(err));
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (selectedProduct) fetchProductDetails(selectedProduct.id);
  }, [selectedProduct, fetchProductDetails]);

  const openNewProduct = () => {
    setEditingProduct(null);
    setFormName('');
    setFormSku('');
    setFormCategoryId('');
    setFormUnitName('bottle');
    setFormReorderThreshold('0');
    setModalMode('product');
  };

  const openEditProduct = (p: Product) => {
    setEditingProduct(p);
    setFormName(p.name);
    setFormSku(p.sku || '');
    setFormCategoryId(p.category_id ?? '');
    setFormUnitName(p.base_unit_name);
    setFormReorderThreshold(String(p.reorder_threshold));
    setModalMode('product');
  };

  const saveProduct = async () => {
    if (!formName.trim()) return;
    try {
      const catVal = formCategoryId === '' ? 'NULL' : String(formCategoryId);
      if (editingProduct) {
        await executeQuery(`UPDATE products SET name = '${formName.replace(/'/g, "''")}', sku = ${formSku ? `'${formSku.replace(/'/g, "''")}'` : 'NULL'}, category_id = ${catVal}, base_unit_name = '${formUnitName.replace(/'/g, "''")}', reorder_threshold = ${Number(formReorderThreshold) || 0} WHERE id = ${editingProduct.id}`);
      } else {
        await executeQuery(`INSERT INTO products (name, sku, category_id, base_unit_name, reorder_threshold) VALUES ('${formName.replace(/'/g, "''")}', ${formSku ? `'${formSku.replace(/'/g, "''")}'` : 'NULL'}, ${catVal}, '${formUnitName.replace(/'/g, "''")}', ${Number(formReorderThreshold) || 0})`);
      }
      setModalMode(null);
      await fetchData();
    } catch (err) {
      setError(String(err));
    }
  };

  const deleteProduct = async (id: number) => {
    if (!confirm(t('prods.confirmDeleteProduct'))) return;
    try {
      await executeQuery(`DELETE FROM inventory_logs WHERE batch_id IN (SELECT id FROM batches WHERE product_id = ${id})`);
      await executeQuery(`DELETE FROM batches WHERE product_id = ${id}`);
      await executeQuery(`DELETE FROM product_attributes WHERE product_id = ${id}`);
      await executeQuery(`DELETE FROM unit_conversions WHERE product_id = ${id}`);
      await executeQuery(`DELETE FROM product_notes WHERE product_id = ${id}`);
      await executeQuery(`DELETE FROM client_reservations WHERE product_id = ${id}`);
      await executeQuery(`DELETE FROM calendar_events WHERE product_id = ${id}`);
      await executeQuery(`DELETE FROM product_notifications WHERE product_id = ${id}`);
      await executeQuery(`DELETE FROM products WHERE id = ${id}`);
      setSelectedProduct(null);
      await fetchData();
    } catch (err) {
      setError(String(err));
    }
  };

  const saveCategory = async () => {
    if (!formCategoryName.trim()) return;
    try {
      await executeQuery(`INSERT INTO categories (name) VALUES ('${formCategoryName.replace(/'/g, "''")}')`);
      setModalMode(null);
      await fetchData();
    } catch (err) {
      setError(String(err));
    }
  };

    const handleDeleteCategory = async (id: number) => {
    if (!confirm(t('prods.confirmDeleteCategory'))) return;
    try {
      await deleteCategory(id);
      await fetchData();
    } catch (err) {
      setError(String(err));
    }
  };

  const saveAttribute = async () => {
    if (!formAttrKey.trim() || !formAttrValue.trim() || !selectedProduct) return;
    try {
      await upsertProductAttribute(selectedProduct.id, formAttrKey.trim(), formAttrValue, formAttrType);
      setModalMode(null);
      await fetchProductDetails(selectedProduct.id);
    } catch (err) {
      setError(String(err));
    }
  };

  const deleteAttribute = async (id: number) => {
    try {
      await executeQuery(`DELETE FROM product_attributes WHERE id = ${id}`);
      if (selectedProduct) await fetchProductDetails(selectedProduct.id);
    } catch (err) {
      setError(String(err));
    }
  };

  const saveUnit = async () => {
    if (!formUnitName2.trim() || !selectedProduct) return;
    try {
      await executeQuery(`INSERT INTO unit_conversions (product_id, unit_name, conversion_factor) VALUES (${selectedProduct.id}, '${formUnitName2.replace(/'/g, "''")}', ${Number(formConversionFactor) || 1})`);
      setModalMode(null);
      await fetchProductDetails(selectedProduct.id);
    } catch (err) {
      setError(String(err));
    }
  };

  const deleteUnit = async (id: number) => {
    try {
      await executeQuery(`DELETE FROM unit_conversions WHERE id = ${id}`);
      if (selectedProduct) await fetchProductDetails(selectedProduct.id);
    } catch (err) {
      setError(String(err));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-text-secondary">
        <RefreshCw size={20} className="animate-spin mr-2" />
        {t('prods.loading')}
      </div>
    );
  }

  return (
    <div className="h-full flex overflow-hidden">
      {/* Product List */}
      <div className="w-[340px] border-r border-border bg-bg-secondary flex flex-col shrink-0">
        <div className="px-3 py-2 border-b border-border flex items-center justify-between">
          <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wide">{t('prods.title')}</h3>
          <div className="flex gap-1">
            <button
              onClick={() => { setFormCategoryName(''); setModalMode('category'); }}
              className="p-1.5 rounded hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors"
              title={t('prods.addCategory')}
            >
              <Tag size={12} />
            </button>
            <button
              onClick={openNewProduct}
              className="p-1.5 rounded hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors"
              title={t('prods.addProduct')}
            >
              <Plus size={12} />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-border">
          {products.map((p) => (
            <div
              key={p.id}
              onClick={() => setSelectedProduct(p)}
              className={`px-3 py-2.5 cursor-pointer transition-colors ${
                selectedProduct?.id === p.id ? 'bg-accent/10 border-l-2 border-accent' : 'hover:bg-bg-hover border-l-2 border-transparent'
              }`}
            >
              <p className="text-sm text-text-primary font-medium truncate">{p.name}</p>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[10px] text-text-secondary">{p.category_name}</span>
                {p.sku && <span className="text-[10px] text-text-secondary font-mono">{p.sku}</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Product Detail */}
      <div className="flex-1 overflow-y-auto p-6">
        {!selectedProduct ? (
          <div className="flex items-center justify-center h-full text-text-secondary text-sm">
            {t('prods.selectEmpty')}
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-text-primary">{selectedProduct.name}</h2>
                <p className="text-xs text-text-secondary">{selectedProduct.category_name}{selectedProduct.sku ? ` · ${selectedProduct.sku}` : ''}</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => openEditProduct(selectedProduct)}
                  className="flex items-center gap-1 px-3 py-1.5 bg-bg-tertiary hover:bg-bg-hover border border-border rounded-md text-xs text-text-secondary transition-colors"
                >
                  <Pencil size={10} /> {t('common.edit')}
                </button>
                <button
                  onClick={() => deleteProduct(selectedProduct.id)}
                  className="flex items-center gap-1 px-3 py-1.5 bg-error/10 hover:bg-error/20 border border-error/20 rounded-md text-xs text-error transition-colors"
                >
                  <Trash2 size={10} /> {t('common.delete')}
                </button>
              </div>
            </div>

            {/* Attributes */}
            <div className="bg-bg-secondary border border-border rounded-lg">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <h3 className="text-sm font-semibold text-text-primary">{t('prods.attributes')}</h3>
                <button
                  onClick={() => { setFormAttrKey(''); setFormAttrValue(''); setFormAttrType('string'); setModalMode('attribute'); }}
                  className="flex items-center gap-1 px-2 py-1 bg-bg-tertiary hover:bg-bg-hover border border-border rounded-md text-[10px] text-text-secondary transition-colors"
                >
                  <Plus size={10} /> {t('common.add')}
                </button>
              </div>
              <div className="divide-y divide-border">
                {productAttrs.length === 0 ? (
                  <div className="p-4 text-xs text-text-secondary text-center">{t('prods.noAttributes')}</div>
                ) : (
                  productAttrs.map((attr) => (
                    <div key={attr.id} className="px-4 py-2.5 flex items-center justify-between">
                      <div>
                        <span className="text-xs font-medium text-accent mr-2">{attr.attr_key}:</span>
                        <span className="text-xs text-text-primary">{attr.attr_value}</span>
                        <span className="text-[10px] text-text-secondary ml-2">({attr.data_type})</span>
                      </div>
                      <button onClick={() => deleteAttribute(attr.id)} className="text-text-secondary hover:text-error transition-colors">
                        <Trash2 size={10} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Unit Conversions */}
            <div className="bg-bg-secondary border border-border rounded-lg">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <h3 className="text-sm font-semibold text-text-primary">{t('prods.conversions')}</h3>
                <button
                  onClick={() => { setFormUnitName2(''); setFormConversionFactor('1'); setModalMode('unit'); }}
                  className="flex items-center gap-1 px-2 py-1 bg-bg-tertiary hover:bg-bg-hover border border-border rounded-md text-[10px] text-text-secondary transition-colors"
                >
                  <Plus size={10} /> {t('common.add')}
                </button>
              </div>
              <div className="divide-y divide-border">
                {productUnits.length === 0 ? (
                  <div className="p-4 text-xs text-text-secondary text-center">{t('prods.noConversions')}</div>
                ) : (
                  productUnits.map((unit) => (
                    <div key={unit.id} className="px-4 py-2.5 flex items-center justify-between">
                      <div>
                        <span className="text-xs text-text-primary font-medium">{unit.unit_name}</span>
                        <span className="text-xs text-text-secondary ml-2">{t('prods.conversionBaseUnit', { factor: unit.conversion_factor })}</span>
                      </div>
                      <button onClick={() => deleteUnit(unit.id)} className="text-text-secondary hover:text-error transition-colors">
                        <Trash2 size={10} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Categories Manager */}
            <div className="bg-bg-secondary border border-border rounded-lg">
              <div className="px-4 py-3 border-b border-border">
                <h3 className="text-sm font-semibold text-text-primary">{t('prods.allCategories')}</h3>
              </div>
              <div className="divide-y divide-border max-h-[200px] overflow-y-auto">
                {categories.map((cat) => (
                  <div key={cat.id} className="px-4 py-2.5 flex items-center justify-between">
                    <span className="text-xs text-text-primary">{cat.name}</span>
                    <button onClick={() => handleDeleteCategory(cat.id)} className="text-text-secondary hover:text-error transition-colors">
                      <Trash2 size={10} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Modal */}
      {modalMode && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setModalMode(null)}>
          <div className="bg-bg-secondary border border-border rounded-lg p-5 w-[380px] shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-text-primary">
                {modalMode === 'product' && (editingProduct ? t('prods.editProduct') : t('prods.newProduct'))}
                {modalMode === 'category' && t('prods.newCategory')}
                {modalMode === 'attribute' && t('prods.newAttribute')}
                {modalMode === 'unit' && t('prods.newConversion')}
              </h3>
              <button onClick={() => setModalMode(null)} className="text-text-secondary hover:text-text-primary">
                <X size={14} />
              </button>
            </div>

            {modalMode === 'product' && (
              <div className="space-y-3">
                <input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder={t('prods.ph.productName')} className="w-full px-3 py-2 bg-bg-primary border border-border rounded-md text-xs text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent" />
                <input value={formSku} onChange={(e) => setFormSku(e.target.value)} placeholder={t('prods.ph.sku')} className="w-full px-3 py-2 bg-bg-primary border border-border rounded-md text-xs text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent" />
                <select value={formCategoryId} onChange={(e) => setFormCategoryId(e.target.value === '' ? '' : Number(e.target.value))} className="w-full px-3 py-2 bg-bg-primary border border-border rounded-md text-xs text-text-primary focus:outline-none focus:border-accent">
                  <option value="">{t('common.uncategorized')}</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <UnitInput value={formUnitName} onChange={setFormUnitName} placeholder={t('prods.ph.baseUnit')} />
                <input value={formReorderThreshold} onChange={(e) => setFormReorderThreshold(e.target.value)} type="number" placeholder={t('prods.ph.reorder')} className="w-full px-3 py-2 bg-bg-primary border border-border rounded-md text-xs text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent" />
              </div>
            )}

            {modalMode === 'category' && (
              <input value={formCategoryName} onChange={(e) => setFormCategoryName(e.target.value)} placeholder={t('prods.ph.categoryName')} className="w-full px-3 py-2 bg-bg-primary border border-border rounded-md text-xs text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent" />
            )}

            {modalMode === 'attribute' && (
              <div className="space-y-3">
                <input value={formAttrKey} onChange={(e) => setFormAttrKey(e.target.value)} placeholder={t('prods.ph.attrKey')} className="w-full px-3 py-2 bg-bg-primary border border-border rounded-md text-xs text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent" />
                <input value={formAttrValue} onChange={(e) => setFormAttrValue(e.target.value)} placeholder={t('prods.ph.attrValue')} className="w-full px-3 py-2 bg-bg-primary border border-border rounded-md text-xs text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent" />
                <select value={formAttrType} onChange={(e) => setFormAttrType(e.target.value)} className="w-full px-3 py-2 bg-bg-primary border border-border rounded-md text-xs text-text-primary focus:outline-none focus:border-accent">
                  <option value="string">{t('common.attrType.string')}</option>
                  <option value="number">{t('common.attrType.number')}</option>
                  <option value="boolean">{t('common.attrType.boolean')}</option>
                </select>
              </div>
            )}

            {modalMode === 'unit' && (
              <div className="space-y-3">
                <input value={formUnitName2} onChange={(e) => setFormUnitName2(e.target.value)} placeholder={t('prods.ph.unitName')} className="w-full px-3 py-2 bg-bg-primary border border-border rounded-md text-xs text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent" />
                <input value={formConversionFactor} onChange={(e) => setFormConversionFactor(e.target.value)} type="number" placeholder={t('prods.ph.conversionFactor')} className="w-full px-3 py-2 bg-bg-primary border border-border rounded-md text-xs text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent" />
              </div>
            )}

            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setModalMode(null)} className="px-3 py-1.5 bg-bg-tertiary hover:bg-bg-hover border border-border rounded-md text-xs text-text-secondary transition-colors">
                {t('common.cancel')}
              </button>
              <button
                onClick={() => {
                  if (modalMode === 'product') saveProduct();
                  else if (modalMode === 'category') saveCategory();
                  else if (modalMode === 'attribute') saveAttribute();
                  else if (modalMode === 'unit') saveUnit();
                }}
                className="flex items-center gap-1 px-3 py-1.5 bg-accent hover:bg-accent-hover rounded-md text-xs text-white transition-colors"
              >
                <Save size={10} /> {t('common.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="fixed bottom-4 right-4 bg-error/10 border border-error/20 text-error px-4 py-2 rounded-lg text-xs shadow-lg z-50">
          {error}
          <button onClick={() => setError(null)} className="ml-2 hover:underline">{t('common.dismiss')}</button>
        </div>
      )}
    </div>
  );
}
