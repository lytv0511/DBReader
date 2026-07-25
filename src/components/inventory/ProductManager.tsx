import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Plus, Pencil, Trash2, X, Save, Tag } from 'lucide-react';
import { executeQuery } from '../../lib/db';

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

export default function ProductManager() {
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
    if (!confirm('Delete this product? Associated attributes, batches, and logs will also be deleted.')) return;
    try {
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

  const deleteCategory = async (id: number) => {
    if (!confirm('Delete this category? Products will be set to Uncategorized.')) return;
    try {
      await executeQuery(`DELETE FROM categories WHERE id = ${id}`);
      await fetchData();
    } catch (err) {
      setError(String(err));
    }
  };

  const saveAttribute = async () => {
    if (!formAttrKey.trim() || !formAttrValue.trim() || !selectedProduct) return;
    try {
      await executeQuery(`INSERT INTO product_attributes (product_id, attr_key, attr_value, data_type) VALUES (${selectedProduct.id}, '${formAttrKey.replace(/'/g, "''")}', '${formAttrValue.replace(/'/g, "''")}', '${formAttrType}')`);
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
        Loading products...
      </div>
    );
  }

  return (
    <div className="h-full flex overflow-hidden">
      {/* Product List */}
      <div className="w-[340px] border-r border-border bg-bg-secondary flex flex-col shrink-0">
        <div className="px-3 py-2 border-b border-border flex items-center justify-between">
          <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Products</h3>
          <div className="flex gap-1">
            <button
              onClick={() => { setFormCategoryName(''); setModalMode('category'); }}
              className="p-1.5 rounded hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors"
              title="Add Category"
            >
              <Tag size={12} />
            </button>
            <button
              onClick={openNewProduct}
              className="p-1.5 rounded hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors"
              title="Add Product"
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
            Select a product to view details
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
                  <Pencil size={10} /> Edit
                </button>
                <button
                  onClick={() => deleteProduct(selectedProduct.id)}
                  className="flex items-center gap-1 px-3 py-1.5 bg-error/10 hover:bg-error/20 border border-error/20 rounded-md text-xs text-error transition-colors"
                >
                  <Trash2 size={10} /> Delete
                </button>
              </div>
            </div>

            {/* Attributes */}
            <div className="bg-bg-secondary border border-border rounded-lg">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <h3 className="text-sm font-semibold text-text-primary">Attributes</h3>
                <button
                  onClick={() => { setFormAttrKey(''); setFormAttrValue(''); setFormAttrType('string'); setModalMode('attribute'); }}
                  className="flex items-center gap-1 px-2 py-1 bg-bg-tertiary hover:bg-bg-hover border border-border rounded-md text-[10px] text-text-secondary transition-colors"
                >
                  <Plus size={10} /> Add
                </button>
              </div>
              <div className="divide-y divide-border">
                {productAttrs.length === 0 ? (
                  <div className="p-4 text-xs text-text-secondary text-center">No attributes</div>
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
                <h3 className="text-sm font-semibold text-text-primary">Unit Conversions</h3>
                <button
                  onClick={() => { setFormUnitName2(''); setFormConversionFactor('1'); setModalMode('unit'); }}
                  className="flex items-center gap-1 px-2 py-1 bg-bg-tertiary hover:bg-bg-hover border border-border rounded-md text-[10px] text-text-secondary transition-colors"
                >
                  <Plus size={10} /> Add
                </button>
              </div>
              <div className="divide-y divide-border">
                {productUnits.length === 0 ? (
                  <div className="p-4 text-xs text-text-secondary text-center">No unit conversions</div>
                ) : (
                  productUnits.map((unit) => (
                    <div key={unit.id} className="px-4 py-2.5 flex items-center justify-between">
                      <div>
                        <span className="text-xs text-text-primary font-medium">{unit.unit_name}</span>
                        <span className="text-xs text-text-secondary ml-2">= {unit.conversion_factor} × base unit</span>
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
                <h3 className="text-sm font-semibold text-text-primary">All Categories</h3>
              </div>
              <div className="divide-y divide-border max-h-[200px] overflow-y-auto">
                {categories.map((cat) => (
                  <div key={cat.id} className="px-4 py-2.5 flex items-center justify-between">
                    <span className="text-xs text-text-primary">{cat.name}</span>
                    <button onClick={() => deleteCategory(cat.id)} className="text-text-secondary hover:text-error transition-colors">
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
                {modalMode === 'product' && (editingProduct ? 'Edit Product' : 'New Product')}
                {modalMode === 'category' && 'New Category'}
                {modalMode === 'attribute' && 'New Attribute'}
                {modalMode === 'unit' && 'New Unit Conversion'}
              </h3>
              <button onClick={() => setModalMode(null)} className="text-text-secondary hover:text-text-primary">
                <X size={14} />
              </button>
            </div>

            {modalMode === 'product' && (
              <div className="space-y-3">
                <input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="Product name" className="w-full px-3 py-2 bg-bg-primary border border-border rounded-md text-xs text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent" />
                <input value={formSku} onChange={(e) => setFormSku(e.target.value)} placeholder="SKU (optional)" className="w-full px-3 py-2 bg-bg-primary border border-border rounded-md text-xs text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent" />
                <select value={formCategoryId} onChange={(e) => setFormCategoryId(e.target.value === '' ? '' : Number(e.target.value))} className="w-full px-3 py-2 bg-bg-primary border border-border rounded-md text-xs text-text-primary focus:outline-none focus:border-accent">
                  <option value="">Uncategorized</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <input value={formUnitName} onChange={(e) => setFormUnitName(e.target.value)} placeholder="Base unit (e.g. bottle)" className="w-full px-3 py-2 bg-bg-primary border border-border rounded-md text-xs text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent" />
                <input value={formReorderThreshold} onChange={(e) => setFormReorderThreshold(e.target.value)} type="number" placeholder="Reorder threshold" className="w-full px-3 py-2 bg-bg-primary border border-border rounded-md text-xs text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent" />
              </div>
            )}

            {modalMode === 'category' && (
              <input value={formCategoryName} onChange={(e) => setFormCategoryName(e.target.value)} placeholder="Category name" className="w-full px-3 py-2 bg-bg-primary border border-border rounded-md text-xs text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent" />
            )}

            {modalMode === 'attribute' && (
              <div className="space-y-3">
                <input value={formAttrKey} onChange={(e) => setFormAttrKey(e.target.value)} placeholder="Attribute key (e.g. Vintage)" className="w-full px-3 py-2 bg-bg-primary border border-border rounded-md text-xs text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent" />
                <input value={formAttrValue} onChange={(e) => setFormAttrValue(e.target.value)} placeholder="Value" className="w-full px-3 py-2 bg-bg-primary border border-border rounded-md text-xs text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent" />
                <select value={formAttrType} onChange={(e) => setFormAttrType(e.target.value)} className="w-full px-3 py-2 bg-bg-primary border border-border rounded-md text-xs text-text-primary focus:outline-none focus:border-accent">
                  <option value="string">String</option>
                  <option value="number">Number</option>
                  <option value="boolean">Boolean</option>
                </select>
              </div>
            )}

            {modalMode === 'unit' && (
              <div className="space-y-3">
                <input value={formUnitName2} onChange={(e) => setFormUnitName2(e.target.value)} placeholder="Unit name (e.g. Case)" className="w-full px-3 py-2 bg-bg-primary border border-border rounded-md text-xs text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent" />
                <input value={formConversionFactor} onChange={(e) => setFormConversionFactor(e.target.value)} type="number" placeholder="Conversion factor" className="w-full px-3 py-2 bg-bg-primary border border-border rounded-md text-xs text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent" />
              </div>
            )}

            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setModalMode(null)} className="px-3 py-1.5 bg-bg-tertiary hover:bg-bg-hover border border-border rounded-md text-xs text-text-secondary transition-colors">
                Cancel
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
                <Save size={10} /> Save
              </button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="fixed bottom-4 right-4 bg-error/10 border border-error/20 text-error px-4 py-2 rounded-lg text-xs shadow-lg z-50">
          {error}
          <button onClick={() => setError(null)} className="ml-2 hover:underline">dismiss</button>
        </div>
      )}
    </div>
  );
}
