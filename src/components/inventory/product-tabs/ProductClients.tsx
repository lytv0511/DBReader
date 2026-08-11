import { useState, useEffect, useCallback } from 'react';
import { Users, UserPlus, Plus, Trash2, Save, X, Edit2 } from 'lucide-react';
import { executeQuery, upsertClient, deleteClient, upsertReservation, deleteReservation } from '../../../lib/db';
import { todayLocalISO } from '../../../lib/dates';
import { useI18n } from '../../../lib/language';

interface Client { id: number; name: string; email: string | null; phone: string | null; company: string | null; notes: string | null; }
interface Reservation { id: number; client_id: number; client_name: string; quantity: number; reserved_date: string; status: string; notes: string | null; }

const STATUS_STYLES: Record<string, string> = {
  reserved: 'bg-accent/10 text-accent', partial: 'bg-warning/10 text-warning',
  fulfilled: 'bg-success/10 text-success', cancelled: 'bg-error/10 text-error',
};

export default function ProductClients({ productId, refreshKey }: { productId: number; refreshKey?: number }) {
  const { t } = useI18n();
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showClientForm, setShowClientForm] = useState(false);
  const [showResForm, setShowResForm] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [clientSectionOpen, setClientSectionOpen] = useState(false);

  const [cName, setCName] = useState('');
  const [cEmail, setCEmail] = useState('');
  const [cPhone, setCPhone] = useState('');
  const [cCompany, setCCompany] = useState('');
  const [cNotes, setCNotes] = useState('');

  const [rClientId, setRClientId] = useState<number | ''>('');
  const [rQty, setRQty] = useState('1');
  const [rDate, setRDate] = useState(todayLocalISO());
  const [rStatus, setRStatus] = useState('reserved');
  const [rNotes, setRNotes] = useState('');

  const fetchData = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const [resResult, clientsResult] = await Promise.all([
        executeQuery(`
          SELECT cr.id, cr.client_id, cl.name, cr.quantity, cr.reserved_date, cr.status, cr.notes
          FROM client_reservations cr JOIN clients cl ON cr.client_id = cl.id
          WHERE cr.product_id = ${productId} ORDER BY cr.reserved_date DESC
        `),
        executeQuery('SELECT id, name, email, phone, company, notes FROM clients ORDER BY name'),
      ]);
      setReservations(resResult.rows.map((r) => ({
        id: r[0] as number, client_id: r[1] as number, client_name: r[2] as string,
        quantity: r[3] as number, reserved_date: r[4] as string, status: r[5] as string, notes: r[6] as string | null,
      })));
      setClients(clientsResult.rows.map((r) => ({
        id: r[0] as number, name: r[1] as string, email: r[2] as string | null,
        phone: r[3] as string | null, company: r[4] as string | null, notes: r[5] as string | null,
      })));
    } catch (err) {
      setError(String(err));
    }
    setLoading(false);
  }, [productId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (refreshKey !== undefined && refreshKey > 0) fetchData(true);
  }, [refreshKey, fetchData]);

  const saveClient = async () => {
    if (!cName.trim()) return;
    try {
      await upsertClient(cName, cEmail || null, cPhone || null, cCompany || null, cNotes || null, editingClient?.id);
      setShowClientForm(false); setEditingClient(null);
      setCName(''); setCEmail(''); setCPhone(''); setCCompany(''); setCNotes('');
      setError(null);
      await fetchData();
    } catch (err) { setError(String(err)); }
  };

  const handleDeleteClient = async (id: number) => {
    if (!confirm(t('pclients.confirmDeleteClient'))) return;
    try { await deleteClient(id); setError(null); await fetchData(); } catch (err) { setError(String(err)); }
  };

  const saveReservation = async () => {
    if (rClientId === '' || !rQty) return;
    try {
      await upsertReservation(Number(rClientId), productId, Number(rQty), rDate, rStatus, rNotes || null, null);
      setShowResForm(false); setRNotes(''); setRQty('1');
      setError(null);
      await fetchData();
    } catch (err) { setError(String(err)); }
  };

  const updateResStatus = async (res: Reservation, newStatus: string) => {
    try {
      await upsertReservation(res.client_id, productId, res.quantity, res.reserved_date, newStatus, res.notes, null, res.id);
      setError(null);
      await fetchData();
    } catch (err) { setError(String(err)); }
  };

  const handleDeleteRes = async (id: number) => {
    if (!confirm(t('pclients.confirmDeleteReservation'))) return;
    try { await deleteReservation(id); setError(null); await fetchData(); } catch (err) { setError(String(err)); }
  };

  const totalReserved = reservations.filter((r) => r.status === 'reserved' || r.status === 'partial').reduce((s, r) => s + r.quantity, 0);
  const statusCounts = reservations.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {} as Record<string, number>);

  if (loading) return <div className="flex items-center justify-center h-full text-text-secondary text-sm">{t('pclients.loading')}</div>;

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6">
      {error && (
        <div className="p-3 bg-error/10 border border-error/20 rounded-lg text-xs text-error">{error}</div>
      )}
      {/* Summary */}
      <div className="grid grid-cols-5 gap-3">
        <div className="bg-bg-secondary border border-border rounded-lg p-3 text-center">
          <p className="text-lg font-bold text-text-primary">{totalReserved}</p>
          <p className="text-[10px] text-text-secondary">{t('pclients.totalReserved')}</p>
        </div>
        {['reserved', 'partial', 'fulfilled', 'cancelled'].map((s) => (
          <div key={s} className="bg-bg-secondary border border-border rounded-lg p-3 text-center">
            <p className={`text-lg font-bold ${STATUS_STYLES[s]?.split(' ')[1] || 'text-text-secondary'}`}>{statusCounts[s] || 0}</p>
            <p className="text-[10px] text-text-secondary capitalize">{t(`common.status.${s}`)}</p>
          </div>
        ))}
      </div>

      {/* Reservations */}
      <div className="bg-bg-secondary border border-border rounded-lg">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h3 className="text-sm font-semibold text-text-primary">{t('pclients.reservations')}</h3>
          <button onClick={() => setShowResForm(!showResForm)} className="flex items-center gap-1 px-2 py-1 bg-bg-tertiary hover:bg-bg-hover border border-border rounded-md text-[10px] text-text-secondary">
            <Plus size={10} /> {t('pclients.reserve')}
          </button>
        </div>
        {showResForm && (
          <div className="px-4 py-3 border-b border-border bg-accent/5 space-y-2">
            <div className="grid grid-cols-4 gap-2">
              <select value={rClientId} onChange={(e) => setRClientId(e.target.value === '' ? '' : Number(e.target.value))} className="px-2 py-1.5 bg-bg-primary border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent">
                <option value="">{t('pclients.selectClient')}</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <input value={rQty} onChange={(e) => setRQty(e.target.value)} type="number" placeholder={t('pclients.phQty')} className="px-2 py-1.5 bg-bg-primary border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent" />
              <input value={rDate} onChange={(e) => setRDate(e.target.value)} type="date" className="px-2 py-1.5 bg-bg-primary border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent" />
              <select value={rStatus} onChange={(e) => setRStatus(e.target.value)} className="px-2 py-1.5 bg-bg-primary border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent">
                <option value="reserved">{t('common.status.reserved')}</option>
                <option value="partial">{t('common.status.partial')}</option>
                <option value="fulfilled">{t('common.status.fulfilled')}</option>
                <option value="cancelled">{t('common.status.cancelled')}</option>
              </select>
            </div>
            <div className="flex gap-2">
              <input value={rNotes} onChange={(e) => setRNotes(e.target.value)} placeholder={t('pclients.phNotes')} className="flex-1 px-2 py-1.5 bg-bg-primary border border-border rounded text-xs text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent" />
              <button onClick={saveReservation} className="flex items-center gap-1 px-3 py-1.5 bg-accent hover:bg-accent-hover rounded text-xs text-white"><Save size={10} /> {t('common.save')}</button>
              <button onClick={() => setShowResForm(false)} className="px-2 py-1.5 bg-bg-tertiary rounded text-xs text-text-secondary"><X size={10} /></button>
            </div>
          </div>
        )}
        <div className="divide-y divide-border max-h-[300px] overflow-y-auto">
          {reservations.map((r) => (
            <div key={r.id} className="px-4 py-2.5 flex items-center gap-3">
              <Users size={12} className="text-text-secondary shrink-0" />
              <span className="text-xs text-text-primary font-medium w-32 truncate">{r.client_name}</span>
              <span className="text-xs text-text-secondary">×{r.quantity}</span>
              <span className="text-[10px] text-text-secondary">{r.reserved_date?.slice(0, 10)}</span>
              <select value={r.status} onChange={(e) => updateResStatus(r, e.target.value)} className={`px-2 py-0.5 rounded text-[10px] font-semibold ${STATUS_STYLES[r.status] || ''} bg-transparent border border-current`}>
                {['reserved', 'partial', 'fulfilled', 'cancelled'].map((s) => <option key={s} value={s}>{t(`common.status.${s}`)}</option>)}
              </select>
              <span className="text-[10px] text-text-secondary flex-1 truncate">{r.notes || ''}</span>
              <button onClick={() => handleDeleteRes(r.id)} className="text-text-secondary hover:text-error"><Trash2 size={10} /></button>
            </div>
          ))}
          {reservations.length === 0 && <div className="p-4 text-xs text-text-secondary text-center">{t('pclients.empty')}</div>}
        </div>
      </div>

      {/* Client Manager */}
      <div className="bg-bg-secondary border border-border rounded-lg">
        <button onClick={() => setClientSectionOpen(!clientSectionOpen)} className="w-full px-4 py-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-text-primary">{t('pclients.clientManager', { count: clients.length })}</h3>
          <span className="text-text-secondary text-xs">{clientSectionOpen ? '▲' : '▼'}</span>
        </button>
        {clientSectionOpen && (
          <div className="border-t border-border">
            <div className="px-4 py-2 border-b border-border flex justify-between items-center">
              <span className="text-[10px] text-text-secondary">{t('pclients.clientsCount', { count: clients.length })}</span>
              <button onClick={() => { setShowClientForm(true); setEditingClient(null); setCName(''); setCEmail(''); setCPhone(''); setCCompany(''); setCNotes(''); }} className="flex items-center gap-1 px-2 py-1 bg-bg-tertiary hover:bg-bg-hover border border-border rounded-md text-[10px] text-text-secondary"><UserPlus size={10} /> {t('pclients.addClient')}</button>
            </div>
            {showClientForm && (
              <div className="px-4 py-3 border-b border-border bg-accent/5 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <input value={cName} onChange={(e) => setCName(e.target.value)} placeholder={t('pclients.phName')} className="px-2 py-1.5 bg-bg-primary border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent" />
                  <input value={cEmail} onChange={(e) => setCEmail(e.target.value)} placeholder={t('pclients.phEmail')} className="px-2 py-1.5 bg-bg-primary border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent" />
                  <input value={cPhone} onChange={(e) => setCPhone(e.target.value)} placeholder={t('pclients.phPhone')} className="px-2 py-1.5 bg-bg-primary border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent" />
                  <input value={cCompany} onChange={(e) => setCCompany(e.target.value)} placeholder={t('pclients.phCompany')} className="px-2 py-1.5 bg-bg-primary border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent" />
                </div>
                <div className="flex gap-2">
                  <button onClick={saveClient} className="flex items-center gap-1 px-3 py-1.5 bg-accent hover:bg-accent-hover rounded text-xs text-white"><Save size={10} /> {t('common.save')}</button>
                  <button onClick={() => setShowClientForm(false)} className="px-2 py-1.5 bg-bg-tertiary rounded text-xs text-text-secondary"><X size={10} /></button>
                </div>
              </div>
            )}
            <div className="divide-y divide-border max-h-[200px] overflow-y-auto">
              {clients.map((c) => (
                <div key={c.id} className="px-4 py-2.5 flex items-center gap-3">
                  <span className="text-xs text-text-primary font-medium flex-1">{c.name}</span>
                  {c.company && <span className="text-[10px] text-text-secondary">{c.company}</span>}
                  {c.email && <span className="text-[10px] text-text-secondary">{c.email}</span>}
                  <button onClick={() => { setEditingClient(c); setShowClientForm(true); setCName(c.name); setCEmail(c.email || ''); setCPhone(c.phone || ''); setCCompany(c.company || ''); setCNotes(c.notes || ''); }} className="text-text-secondary hover:text-text-primary"><Edit2 size={10} /></button>
                  <button onClick={() => handleDeleteClient(c.id)} className="text-text-secondary hover:text-error"><Trash2 size={10} /></button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
