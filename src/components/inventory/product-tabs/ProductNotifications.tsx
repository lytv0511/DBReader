import { useState, useEffect, useCallback } from 'react';
import { Bell, BellOff, Plus, Trash2, Save, X, AlertTriangle, TrendingDown } from 'lucide-react';
import { executeQuery, upsertNotification, deleteNotification } from '../../../lib/db';
import { useI18n } from '../../../lib/language';

interface Notification {
  id: number;
  notification_type: string;
  message: string;
  threshold_value: number | null;
  is_active: boolean;
  last_triggered: string | null;
}

interface ProductNotificationsProps {
  productId: number;
  refreshKey?: number;
}

const NOTIFICATION_TYPES = [
  { value: 'low_stock', label: 'Low Stock', color: 'warning' },
  { value: 'expiry', label: 'Expiry', color: 'error' },
  { value: 'custom', label: 'Custom', color: 'accent' },
  { value: 'reorder', label: 'Reorder', color: 'primary' },
  { value: 'reservation', label: 'Reservation', color: 'pink' },
];

const NOTIFICATION_LABEL_KEYS: Record<string, string> = {
  low_stock: 'pnotif.type.lowStock',
  expiry: 'pnotif.type.expiry',
  custom: 'pnotif.type.custom',
  reorder: 'pnotif.type.reorder',
  reservation: 'pnotif.type.reservation',
};

export default function ProductNotifications({ productId, refreshKey }: ProductNotificationsProps) {
  const { t } = useI18n();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [currentStock, setCurrentStock] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formType, setFormType] = useState('low_stock');
  const [formMessage, setFormMessage] = useState('');
  const [formThreshold, setFormThreshold] = useState('');
  const [formActive, setFormActive] = useState(true);

  const fetchData = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const [stockResult, notifsResult] = await Promise.all([
        executeQuery(`
          SELECT COALESCE(SUM(il.quantity_change), 0) FROM batches b
          JOIN inventory_logs il ON il.batch_id = b.id
          WHERE b.product_id = ${productId}
        `),
        executeQuery(`
          SELECT id, notification_type, message, threshold_value, is_active, last_triggered
          FROM product_notifications
          WHERE product_id = ${productId}
          ORDER BY notification_type, created_at DESC
        `),
      ]);

      setCurrentStock(stockResult.rows[0]?.[0] as number ?? 0);

      setNotifications(notifsResult.rows.map((r) => ({
        id: r[0] as number,
        notification_type: r[1] as string,
        message: r[2] as string,
        threshold_value: r[3] as number | null,
        is_active: !!r[4],
        last_triggered: r[5] as string | null,
      })));
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (refreshKey !== undefined && refreshKey > 0) fetchData(true);
  }, [refreshKey, fetchData]);

  const handleToggleActive = async (notif: Notification) => {
    try {
      await upsertNotification(
        productId,
        notif.notification_type,
        notif.message,
        notif.threshold_value,
        !notif.is_active,
        notif.id
      );
      await fetchData();
    } catch (err) {
      setError(String(err));
    }
  };

  const handleSave = async () => {
    if (!formMessage.trim()) return;
    try {
      await upsertNotification(
        productId,
        formType,
        formMessage.trim(),
        formThreshold ? Number(formThreshold) : null,
        formActive
      );
      setShowForm(false);
      setFormMessage('');
      setFormThreshold('');
      setFormActive(true);
      await fetchData();
    } catch (err) {
      setError(String(err));
    }
  };

  const handleDelete = async (notifId: number) => {
    if (!confirm(t('pnotif.confirmDelete'))) return;
    try {
      await deleteNotification(notifId);
      await fetchData();
    } catch (err) {
      setError(String(err));
    }
  };

  const badgeStyles: Record<string, string> = {
    low_stock: 'bg-warning/10 text-warning border-warning/20',
    expiry: 'bg-error/10 text-error border-error/20',
    custom: 'bg-accent/10 text-accent border-accent/20',
    reorder: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    reservation: 'bg-pink-500/10 text-pink-400 border-pink-500/20',
  };

  const typeIcon: Record<string, React.ReactNode> = {
    low_stock: <TrendingDown size={12} />,
    expiry: <AlertTriangle size={12} />,
    custom: <Bell size={12} />,
    reorder: <Bell size={12} />,
    reservation: <Bell size={12} />,
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-text-secondary">
        <Bell size={20} className="animate-spin mr-2" />
        {t('pnotif.loading')}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Stock context */}
      <div className="px-6 py-4 border-b border-border bg-bg-secondary shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Bell size={16} className="text-accent" />
            <div>
              <h3 className="text-sm font-semibold text-text-primary">{t('pnotif.title')}</h3>
              <p className="text-[10px] text-text-secondary">
                {t('pnotif.configured', { count: notifications.length })}
                {currentStock !== null && (
                  <span className="ml-2">
                    {t('pnotif.currentStock', { stock: currentStock })}
                  </span>
                )}
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-accent hover:bg-accent-hover rounded-md text-xs text-white transition-colors"
          >
            {showForm ? <X size={12} /> : <Plus size={12} />}
            {showForm ? t('common.cancel') : t('pnotif.addAlert')}
          </button>
        </div>
      </div>

      {/* Add form */}
      {showForm && (
        <div className="px-6 py-4 border-b border-border bg-bg-primary/50 shrink-0">
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <label className="text-xs text-text-secondary w-16 shrink-0">{t('pnotif.type')}</label>
              <select
                value={formType}
                onChange={(e) => setFormType(e.target.value)}
                className="flex-1 px-2 py-1.5 bg-bg-primary border border-border rounded-md text-xs text-text-primary focus:outline-none focus:border-accent"
              >
                {NOTIFICATION_TYPES.map((nt) => (
                  <option key={nt.value} value={nt.value}>{t(NOTIFICATION_LABEL_KEYS[nt.value])}</option>
                ))}
              </select>
              <label className="text-xs text-text-secondary w-16 shrink-0 text-right">{t('pnotif.threshold')}</label>
              <input
                value={formThreshold}
                onChange={(e) => setFormThreshold(e.target.value)}
                type="number"
                placeholder={t('pnotif.optional')}
                className="w-24 px-2 py-1.5 bg-bg-primary border border-border rounded-md text-xs text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent"
              />
            </div>
            <div className="flex items-start gap-3">
              <label className="text-xs text-text-secondary w-16 shrink-0 mt-1.5">{t('pnotif.message')}</label>
              <textarea
                value={formMessage}
                onChange={(e) => setFormMessage(e.target.value)}
                placeholder={t('pnotif.phMessage')}
                rows={2}
                className="flex-1 px-2 py-1.5 bg-bg-primary border border-border rounded-md text-xs text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent resize-none"
              />
            </div>
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
                <button
                  type="button"
                  onClick={() => setFormActive(!formActive)}
                  className={`relative w-8 h-[18px] rounded-full transition-colors ${formActive ? 'bg-accent' : 'bg-bg-tertiary'}`}
                >
                  <span className={`absolute top-[2px] left-[2px] w-[14px] h-[14px] bg-white rounded-full transition-transform ${formActive ? 'translate-x-[14px]' : ''}`} />
                </button>
                {t('pnotif.active')}
              </label>
              <div className="flex gap-2">
                <button onClick={() => setShowForm(false)} className="px-3 py-1.5 bg-bg-tertiary hover:bg-bg-hover border border-border rounded-md text-xs text-text-secondary transition-colors">{t('common.cancel')}</button>
                <button onClick={handleSave} disabled={!formMessage.trim()} className="flex items-center gap-1 px-3 py-1.5 bg-accent hover:bg-accent-hover rounded-md text-xs text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                  <Save size={10} /> {t('common.save')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Notifications list */}
      <div className="flex-1 overflow-y-auto">
        {error && (
          <div className="mx-6 mt-4 p-3 bg-error/10 border border-error/20 rounded-lg text-xs text-error">{error}</div>
        )}
        {notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-text-secondary">
            <BellOff size={32} className="mb-3 opacity-30" />
            <p className="text-sm">{t('pnotif.empty')}</p>
            <p className="text-[10px] mt-1">{t('pnotif.emptyHint')}</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {notifications.map((notif) => (
              <div key={notif.id} className="px-6 py-3 flex items-center gap-3 hover:bg-bg-hover transition-colors">
                <span className={`flex items-center gap-1.5 px-2 py-0.5 rounded border text-[10px] font-semibold shrink-0 ${badgeStyles[notif.notification_type] || badgeStyles.custom}`}>
                  {typeIcon[notif.notification_type] || typeIcon.custom}
                  {t(NOTIFICATION_LABEL_KEYS[notif.notification_type] || notif.notification_type.replace('_', ' '))}
                </span>
                <span className="text-xs text-text-primary flex-1 truncate">{notif.message}</span>
                {notif.threshold_value !== null && (
                  <span className="text-[10px] text-text-secondary px-1.5 py-0.5 bg-bg-primary border border-border rounded font-mono">
                    {notif.threshold_value}
                  </span>
                )}
                <span className="text-[10px] text-text-secondary whitespace-nowrap">
                  {notif.last_triggered ? new Date(notif.last_triggered).toLocaleDateString() : t('pnotif.never')}
                </span>
                <button
                  onClick={() => handleToggleActive(notif)}
                  className={`p-1 rounded transition-colors ${notif.is_active ? 'text-accent hover:text-accent-hover' : 'text-text-secondary hover:text-text-primary'}`}
                  title={notif.is_active ? t('pnotif.deactivate') : t('pnotif.activate')}
                >
                  {notif.is_active ? <Bell size={12} /> : <BellOff size={12} />}
                </button>
                <button
                  onClick={() => handleDelete(notif.id)}
                  className="p-1 rounded text-text-secondary hover:text-error hover:bg-error/10 transition-colors"
                  title={t('common.delete')}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
