import { useState, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Plus, Trash2, Check, X } from 'lucide-react';
import { executeQuery, upsertCalendarEvent, toggleCalendarEvent, deleteCalendarEvent } from '../../../lib/db';

interface CalEvent {
  id: number;
  title: string;
  event_type: string;
  event_date: string;
  end_date: string | null;
  quantity: number | null;
  notes: string | null;
  is_completed: boolean;
}

const EVENT_COLORS: Record<string, string> = {
  purchase: 'bg-success',
  shipping: 'bg-purple-500',
  delivery: 'bg-cyan-500',
  tasting: 'bg-amber-500',
  reservation: 'bg-pink-500',
  custom: 'bg-text-secondary',
};

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

export default function ProductCalendar({ productId }: { productId: number }) {
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [showForm, setShowForm] = useState(false);
  const [formTitle, setFormTitle] = useState('');
  const [formType, setFormType] = useState('purchase');
  const [formDate, setFormDate] = useState(new Date().toISOString().slice(0, 10));
  const [formEndDate, setFormEndDate] = useState('');
  const [formQty, setFormQty] = useState('');
  const [formNotes, setFormNotes] = useState('');

  const fetchData = useCallback(async () => {
    try {
      const result = await executeQuery(
        `SELECT id, title, event_type, event_date, end_date, quantity, notes, is_completed FROM calendar_events WHERE product_id = ${productId} OR product_id IS NULL ORDER BY event_date`
      );
      setEvents(result.rows.map((r) => ({
        id: r[0] as number, title: r[1] as string, event_type: r[2] as string,
        event_date: r[3] as string, end_date: r[4] as string | null,
        quantity: r[5] as number | null, notes: r[6] as string | null, is_completed: !!r[7],
      })));
    } catch (e) { console.error('Failed to load calendar events:', e); }
  }, [productId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date().toISOString().slice(0, 10);

  const getEventsForDay = (day: number) => {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return events.filter((e) => e.event_date?.slice(0, 10) === dateStr);
  };

  const handleSubmit = async () => {
    if (!formTitle.trim()) return;
    try {
      await upsertCalendarEvent(
        productId, formTitle, formType, formDate,
        formEndDate || null, formQty ? Number(formQty) : null, formNotes || null
      );
      setShowForm(false);
      setFormTitle(''); setFormNotes(''); setFormQty(''); setFormEndDate('');
      await fetchData();
    } catch (e) { console.error('Failed to save calendar event:', e); }
  };

  const handleToggle = async (event: CalEvent) => {
    try { await toggleCalendarEvent(event.id, !event.is_completed); await fetchData(); } catch (e) { console.error('Failed to toggle event:', e); }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this event?')) return;
    try { await deleteCalendarEvent(id); await fetchData(); } catch (e) { console.error('Failed to delete event:', e); }
  };

  const calendarCells: React.ReactNode[] = [];
  for (let i = 0; i < firstDay; i++) {
    calendarCells.push(<div key={`empty-${i}`} className="h-20 bg-bg-primary/30" />);
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const dayEvents = getEventsForDay(day);
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    calendarCells.push(
      <div key={day} className={`h-20 border border-border p-1 ${dateStr === today ? 'bg-accent/5 border-accent/30' : 'bg-bg-primary/50'}`}>
        <span className={`text-xs font-medium ${dateStr === today ? 'text-accent' : 'text-text-secondary'}`}>{day}</span>
        <div className="mt-0.5 space-y-0.5">
          {dayEvents.slice(0, 3).map((e) => (
            <div key={e.id} className={`text-[9px] px-1 py-0.5 rounded truncate ${EVENT_COLORS[e.event_type] || 'bg-gray-500'} text-white`}>
              {e.title}
            </div>
          ))}
          {dayEvents.length > 3 && <span className="text-[8px] text-text-secondary">+{dayEvents.length - 3} more</span>}
        </div>
      </div>
    );
  }
  while (calendarCells.length % 7 !== 0) {
    calendarCells.push(<div key={`tail-${calendarCells.length}`} className="h-20 bg-bg-primary/30" />);
  }

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => setCurrentDate(new Date(year, month - 1))} className="p-1.5 rounded hover:bg-bg-hover text-text-secondary"><ChevronLeft size={16} /></button>
          <h3 className="text-sm font-bold text-text-primary w-40 text-center">{MONTHS[month]} {year}</h3>
          <button onClick={() => setCurrentDate(new Date(year, month + 1))} className="p-1.5 rounded hover:bg-bg-hover text-text-secondary"><ChevronRight size={16} /></button>
          <button onClick={() => setCurrentDate(new Date())} className="px-2 py-1 text-[10px] bg-bg-tertiary hover:bg-bg-hover border border-border rounded text-text-secondary">Today</button>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-1.5 px-3 py-1.5 bg-accent hover:bg-accent-hover rounded-md text-xs text-white">
          <Plus size={12} /> Add Event
        </button>
      </div>

      {showForm && (
        <div className="bg-bg-secondary border border-border rounded-lg p-4 space-y-3">
          <div className="grid grid-cols-4 gap-3">
            <input value={formTitle} onChange={(e) => setFormTitle(e.target.value)} placeholder="Event title" className="col-span-2 px-3 py-2 bg-bg-primary border border-border rounded-md text-xs text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent" />
            <select value={formType} onChange={(e) => setFormType(e.target.value)} className="px-3 py-2 bg-bg-primary border border-border rounded-md text-xs text-text-primary focus:outline-none focus:border-accent">
              <option value="purchase">Purchase</option>
              <option value="shipping">Shipping</option>
              <option value="delivery">Delivery</option>
              <option value="tasting">Tasting</option>
              <option value="reservation">Reservation</option>
              <option value="custom">Custom</option>
            </select>
            <input value={formDate} onChange={(e) => setFormDate(e.target.value)} type="date" className="px-3 py-2 bg-bg-primary border border-border rounded-md text-xs text-text-primary focus:outline-none focus:border-accent" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <input value={formEndDate} onChange={(e) => setFormEndDate(e.target.value)} type="date" placeholder="End date" className="px-3 py-2 bg-bg-primary border border-border rounded-md text-xs text-text-primary focus:outline-none focus:border-accent" />
            <input value={formQty} onChange={(e) => setFormQty(e.target.value)} type="number" placeholder="Quantity" className="px-3 py-2 bg-bg-primary border border-border rounded-md text-xs text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent" />
            <input value={formNotes} onChange={(e) => setFormNotes(e.target.value)} placeholder="Notes" className="px-3 py-2 bg-bg-primary border border-border rounded-md text-xs text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent" />
          </div>
          <div className="flex gap-2">
            <button onClick={handleSubmit} className="flex items-center gap-1 px-3 py-1.5 bg-accent hover:bg-accent-hover rounded-md text-xs text-white"><Check size={10} /> Save</button>
            <button onClick={() => setShowForm(false)} className="px-3 py-1.5 bg-bg-tertiary hover:bg-bg-hover border border-border rounded-md text-xs text-text-secondary"><X size={10} /> Cancel</button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-7 gap-px bg-border rounded-lg overflow-hidden">
        {DAYS.map((d) => (
          <div key={d} className="bg-bg-secondary px-2 py-1.5 text-[10px] font-semibold text-text-secondary text-center">{d}</div>
        ))}
        {calendarCells}
      </div>

      <div className="bg-bg-secondary border border-border rounded-lg">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold text-text-primary">Upcoming Events</h3>
        </div>
        <div className="divide-y divide-border max-h-[300px] overflow-y-auto">
          {events.filter((e) => !e.is_completed).slice(0, 20).map((event) => (
            <div key={event.id} className="px-4 py-2.5 flex items-center gap-3">
              <button onClick={() => handleToggle(event)} className="w-5 h-5 rounded border border-border hover:border-accent flex items-center justify-center shrink-0">
                {event.is_completed && <Check size={10} className="text-success" />}
              </button>
              <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${EVENT_COLORS[event.event_type] || 'bg-gray-500'} text-white`}>
                {event.event_type}
              </span>
              <span className="text-xs text-text-primary flex-1">{event.title}</span>
              <span className="text-[10px] text-text-secondary">{event.event_date?.slice(0, 10)}</span>
              {event.quantity != null && <span className="text-[10px] text-text-secondary">×{event.quantity}</span>}
              <button onClick={() => handleDelete(event.id)} className="text-text-secondary hover:text-error"><Trash2 size={10} /></button>
            </div>
          ))}
          {events.filter((e) => !e.is_completed).length === 0 && (
            <div className="p-4 text-xs text-text-secondary text-center">No upcoming events</div>
          )}
        </div>
      </div>
    </div>
  );
}
