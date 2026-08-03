import { useState } from 'react';
import { ArrowLeft, Pencil, Save, X } from 'lucide-react';
import { updateProduct } from '../../lib/db';
import type { Product } from './ProductGallery';
import ProductHistory from './product-tabs/ProductHistory';
import ProductFields from './product-tabs/ProductFields';
import ProductNotes from './product-tabs/ProductNotes';
import ProductCalendar from './product-tabs/ProductCalendar';
import ProductClients from './product-tabs/ProductClients';
import ProductNotifications from './product-tabs/ProductNotifications';
import ProductReport from './product-tabs/ProductReport';
import { useI18n } from '../../lib/language';

type TabId = 'history' | 'fields' | 'calendar' | 'notes' | 'clients' | 'alerts' | 'report';

interface Tab {
  id: TabId;
  label: string;
}

const TABS: Tab[] = [
  { id: 'history', label: 'History' },
  { id: 'fields', label: 'Fields' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'notes', label: 'Notes' },
  { id: 'clients', label: 'Clients' },
  { id: 'alerts', label: 'Alerts' },
  { id: 'report', label: 'Report' },
];

interface ProductDetailProps {
  product: Product;
  onBack: () => void;
}

export default function ProductDetail({ product, onBack }: ProductDetailProps) {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<TabId>('history');
  const [editingProduct, setEditingProduct] = useState(false);
  const [formName, setFormName] = useState(product.name);
  const [formSku, setFormSku] = useState(product.sku || '');
  const [formReorder, setFormReorder] = useState(String(product.reorder_threshold));
  const [error, setError] = useState<string | null>(null);

  const saveProduct = async () => {
    try {
      await updateProduct(product.id, formName, formSku || null, product.category_id, product.base_unit_name || 'unit', Number(formReorder) || 0);
      setEditingProduct(false);
    } catch (err) {
      setError(String(err));
    }
  };

  const renderTab = () => {
    switch (activeTab) {
      case 'history':
        return <ProductHistory productId={product.id} />;
      case 'fields':
        return <ProductFields productId={product.id} categoryId={product.category_id} />;
      case 'calendar':
        return <ProductCalendar productId={product.id} />;
      case 'notes':
        return <ProductNotes productId={product.id} />;
      case 'clients':
        return <ProductClients productId={product.id} />;
      case 'alerts':
        return <ProductNotifications productId={product.id} />;
      case 'report':
        return <ProductReport productId={product.id} />;
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-bg-secondary border-b border-border px-6 py-4">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2 rounded-lg hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors">
            <ArrowLeft size={16} />
          </button>
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl border"
            style={{ backgroundColor: `${product.category_color}15`, borderColor: `${product.category_color}30` }}
          >
            {product.category_icon}
          </div>
          <div className="flex-1">
            {editingProduct ? (
              <div className="flex items-center gap-2">
                <input value={formName} onChange={(e) => setFormName(e.target.value)} className="px-2 py-1 bg-bg-primary border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent" />
                <input value={formSku} onChange={(e) => setFormSku(e.target.value)} placeholder={t('detail.sku')} className="px-2 py-1 bg-bg-primary border border-border rounded text-xs text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent w-28" />
                <input value={formReorder} onChange={(e) => setFormReorder(e.target.value)} type="number" placeholder={t('detail.reorder')} className="px-2 py-1 bg-bg-primary border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent w-20" />
                <button onClick={saveProduct} className="p-1.5 bg-accent hover:bg-accent-hover rounded text-white"><Save size={12} /></button>
                <button onClick={() => setEditingProduct(false)} className="p-1.5 bg-bg-tertiary hover:bg-bg-hover rounded text-text-secondary"><X size={12} /></button>
              </div>
            ) : (
              <div>
                <h2 className="text-lg font-bold text-text-primary">{product.name}</h2>
                <p className="text-xs text-text-secondary">{product.category_name}{product.sku ? ` · ${product.sku}` : ''}</p>
              </div>
            )}
          </div>
          {!editingProduct && (
            <button onClick={() => setEditingProduct(true)} className="flex items-center gap-1 px-3 py-1.5 bg-bg-tertiary hover:bg-bg-hover border border-border rounded-md text-xs text-text-secondary transition-colors">
              <Pencil size={10} /> {t('detail.edit')}
            </button>
          )}
        </div>
      </div>

      {/* Tab bar */}
      <div className="sticky top-[73px] z-10 bg-bg-secondary border-b border-border px-6 flex gap-0">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-accent text-accent'
                : 'border-transparent text-text-secondary hover:text-text-primary hover:border-border'
            }`}
          >
            {t(`detail.tab.${tab.id}`)}
          </button>
        ))}
      </div>

      <div className="p-6">
        {error && (
          <div className="mb-4 p-3 bg-error/10 border border-error/20 rounded-lg text-xs text-error">{error}</div>
        )}
        {renderTab()}
      </div>
    </div>
  );
}
