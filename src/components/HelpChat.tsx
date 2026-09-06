import { useEffect, useRef, useState } from 'react';
import { MessageCircle, Send, X, BookOpen, Search } from 'lucide-react';
import { useI18n } from '../lib/language';
import { allTopics, getTopic, matchHelp, type HelpTopic } from '../lib/help';
import { WIKI_SECTIONS, getWikiSection } from '../lib/wiki';

interface ChatMessage {
  role: 'user' | 'bot';
  text: string;
  topicId?: string;
}

interface HelpChatProps {
  open: boolean;
  onClose: () => void;
}

export default function HelpChat({ open, onClose }: HelpChatProps) {
  const { t } = useI18n();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [view, setView] = useState<'chat' | 'docs'>('chat');
  const [docQuery, setDocQuery] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [size, setSize] = useState({ w: 460, h: 600 });
  const [dragging, setDragging] = useState(false);
  const docsScrollRef = useRef<HTMLDivElement>(null);
  const docsLastTop = useRef(0);
  const chatLastTop = useRef(0);
  const [showDocsTags, setShowDocsTags] = useState(true);
  const [showChatTags, setShowChatTags] = useState(true);
  const dragRef = useRef<{
    mode: 'move' | 'resize';
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    origW: number;
    origH: number;
  } | null>(null);

  useEffect(() => {
    if (open) {
      setMessages([
        {
          role: 'bot',
          text: t('help.greeting'),
          topicId: '',
        },
      ]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const startDrag = (e: React.PointerEvent, mode: 'move' | 'resize') => {
    if (e.button !== 0) return;
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = {
      mode,
      startX: e.clientX,
      startY: e.clientY,
      origX: rect.left,
      origY: rect.top,
      origW: rect.width,
      origH: rect.height,
    };
    setPos({ x: rect.left, y: rect.top });
    setDragging(true);
  };

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (d.mode === 'move') {
        setPos({
          x: Math.max(0, Math.min(d.origX + e.clientX - d.startX, window.innerWidth - 80)),
          y: Math.max(0, Math.min(d.origY + e.clientY - d.startY, window.innerHeight - 60)),
        });
      } else {
        setSize({
          w: Math.max(300, Math.min(d.origW + e.clientX - d.startX, window.innerWidth - d.origX)),
          h: Math.max(360, Math.min(d.origH + e.clientY - d.startY, window.innerHeight - d.origY)),
        });
      }
    };
    const onUp = () => {
      dragRef.current = null;
      setDragging(false);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragging]);

  if (!open) return null;

  const pushUser = (text: string) => {
    setMessages((prev) => [...prev, { role: 'user', text }]);
  };

  const pushBotTopic = (topic: HelpTopic) => {
    setMessages((prev) => [
      ...prev,
      {
        role: 'bot',
        text: `${t('help.whatLabel')}\n${t(`help.what.${topic.id}`)}\n\n${t(`help.topic.${topic.id}`)}`,
        topicId: topic.id,
      },
    ]);
  };

  const askTopic = (topicId: string) => {
    const topic = getTopic(topicId);
    if (!topic) return;
    pushUser(t(`help.chip.${topic.id}`));
    pushBotTopic(topic);
  };

  const handleSend = () => {
    const query = input.trim();
    if (!query) return;
    pushUser(query);
    setInput('');
    const topic = matchHelp(query);
    if (topic) {
      pushBotTopic(topic);
    } else {
      setMessages((prev) => [...prev, { role: 'bot', text: t('help.fallback'), topicId: '' }]);
    }
  };

  const topicFor = (msg: ChatMessage): HelpTopic | null =>
    msg.topicId ? getTopic(msg.topicId) : null;

  const docSections = WIKI_SECTIONS.filter((s) => {
    if (!docQuery.trim()) return true;
    const q = docQuery.trim().toLowerCase();
    const haystack = [t(s.titleKey), ...s.blocks.flatMap((b) => b.keys.map((k) => t(k)))]
      .join(' ')
      .toLowerCase();
    return haystack.includes(q);
  });

  const goToSection = (id: string) => {
    document.getElementById(`wiki-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleDocsScroll = () => {
    const el = docsScrollRef.current;
    if (!el) return;
    const delta = el.scrollTop - docsLastTop.current;
    if (delta > 6) setShowDocsTags(false);
    else if (delta < -6) setShowDocsTags(true);
    docsLastTop.current = el.scrollTop;
  };

  const handleChatScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const delta = el.scrollTop - chatLastTop.current;
    if (delta > 6) setShowChatTags(false);
    else if (delta < -6) setShowChatTags(true);
    chatLastTop.current = el.scrollTop;
  };

  return (
    <div
      ref={panelRef}
      style={{ width: size.w, height: size.h, ...(pos ? { left: pos.x, top: pos.y } : {}) }}
      className={`fixed z-50 flex flex-col bg-bg-secondary border border-border rounded-xl shadow-2xl overflow-hidden ${
        pos ? '' : 'bottom-4 right-4'
      } ${dragging ? 'select-none' : ''}`}
    >
      {/* Header — drag to move */}
      <div
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest('button')) return;
          startDrag(e, 'move');
        }}
        className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-bg-tertiary shrink-0 cursor-grab active:cursor-grabbing touch-none"
      >
        {view === 'chat' ? (
          <MessageCircle size={16} className="text-accent" />
        ) : (
          <BookOpen size={16} className="text-accent" />
        )}
        <span className="text-sm font-semibold text-text-primary flex-1 truncate">{t('help.title')}</span>
        <div className="flex items-center bg-bg-secondary border border-border rounded-md overflow-hidden">
          <button
            onClick={() => { setView('chat'); setShowChatTags(true); }}
            className={`px-2.5 py-1 text-xs transition-colors ${
              view === 'chat' ? 'bg-accent text-white' : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            {t('help.chatTab')}
          </button>
          <button
            onClick={() => { setView('docs'); setShowDocsTags(true); }}
            className={`px-2.5 py-1 text-xs transition-colors ${
              view === 'docs' ? 'bg-accent text-white' : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            {t('help.docsTab')}
          </button>
        </div>
        <button onClick={onClose} className="text-text-secondary hover:text-text-primary transition-colors">
          <X size={16} />
        </button>
      </div>

      {view === 'docs' ? (
        <>
          {/* Docs search + index */}
          <div className="shrink-0 px-3 pt-2.5 pb-1.5 flex flex-col gap-2 border-b border-border">
            <div className="flex items-center gap-1.5 px-2 py-1.5 bg-bg-primary border border-border rounded-md">
              <Search size={13} className="text-text-secondary shrink-0" />
              <input
                type="text"
                value={docQuery}
                onChange={(e) => setDocQuery(e.target.value)}
                placeholder={t('help.docsSearch')}
                className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-secondary focus:outline-none"
              />
            </div>
            <div className={`flex flex-wrap gap-1.5 ${showDocsTags ? '' : 'hidden'}`}>
              {docSections.map((s) => (
                <button
                  key={s.id}
                  onClick={() => goToSection(s.id)}
                  className="px-2 py-0.5 bg-bg-tertiary hover:bg-bg-hover border border-border rounded-full text-xs text-text-secondary hover:text-text-primary transition-colors"
                >
                  {t(s.titleKey)}
                </button>
              ))}
            </div>
          </div>

          {/* Docs content */}
          <div ref={docsScrollRef} onScroll={handleDocsScroll} className="flex-1 overflow-y-auto p-3 space-y-4">
            {docSections.length === 0 && (
              <p className="text-sm text-text-secondary text-center py-6">{t('help.docsNoResults')}</p>
            )}
            {docSections.map((s) => (
              <section key={s.id} id={`wiki-${s.id}`} className="space-y-1.5 scroll-mt-2">
                <h3 className="text-sm font-bold text-accent border-b border-border pb-1">{t(s.titleKey)}</h3>
                {s.blocks.map((b, i) => {
                  if (b.type === 'p') {
                    return (
                      <p key={i} className="text-[13px] leading-relaxed text-text-primary">
                        {t(b.keys[0])}
                      </p>
                    );
                  }
                  return (
                    <ul key={i} className="space-y-1 pl-1">
                      {b.keys.map((k) => (
                        <li key={k} className="text-[13px] leading-relaxed text-text-primary flex gap-1.5">
                          <span className="text-text-secondary shrink-0">
                            {b.type === 'steps' ? '•' : '–'}
                          </span>
                          <span>{t(k)}</span>
                        </li>
                      ))}
                    </ul>
                  );
                })}
                {s.related.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <span className="text-xs text-text-secondary">{t('help.docsSeeAlso')}</span>
                    {s.related.map((id) => {
                      const rel = getWikiSection(id);
                      if (!rel) return null;
                      return (
                        <button
                          key={id}
                          onClick={() => goToSection(id)}
                          className="px-2 py-0.5 bg-accent/10 hover:bg-accent/20 border border-accent/30 rounded-full text-xs text-accent transition-colors"
                        >
                          {t(rel.titleKey)}
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>
            ))}
          </div>
        </>
      ) : (
        <>
          {/* Messages */}
          <div ref={scrollRef} onScroll={handleChatScroll} className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
            {messages.map((msg, i) => {
              const topic = topicFor(msg);
              return (
                <div key={i} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                  <div
                    className={`max-w-[85%] px-3 py-2 rounded-lg text-sm leading-relaxed whitespace-pre-line ${
                      msg.role === 'user'
                        ? 'bg-accent text-white rounded-br-sm'
                        : 'bg-bg-primary border border-border text-text-primary rounded-bl-sm'
                    }`}
                  >
                    {msg.text}
                  </div>
                  {msg.role === 'bot' && (
                    <div className={`flex flex-wrap gap-1.5 mt-1.5 ${showChatTags ? '' : 'hidden'}`}>
                      {(topic ? topic.related : allTopics().map((tp) => tp.id)).map((rel) => (
                        <button
                          key={rel}
                          onClick={() => askTopic(rel)}
                          className="px-2 py-0.5 bg-bg-tertiary hover:bg-bg-hover border border-border rounded-full text-xs text-text-secondary hover:text-text-primary transition-colors"
                        >
                          {t(`help.chip.${rel}`)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Input */}
          <div className="chat-input flex items-center gap-2 px-3 py-2.5 border-t border-border bg-bg-secondary shrink-0">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSend();
              }}
              placeholder={t('help.placeholder')}
              className="flex-1 px-3 py-1.5 bg-bg-primary border border-border rounded-md text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent"
            />
            <button
              onClick={handleSend}
              className="flex items-center justify-center w-7 h-7 bg-accent hover:bg-accent-hover rounded-md text-white transition-colors"
              title={t('help.send')}
            >
              <Send size={12} />
            </button>
          </div>
        </>
      )}

      {/* Resize handle — bottom-right corner */}
      <div
        onPointerDown={(e) => startDrag(e, 'resize')}
        className="absolute bottom-0 right-0 w-5 h-5 cursor-nwse-resize touch-none flex items-end justify-end"
        title={t('help.dragResize')}
      >
        <div className="w-4 h-4 border-b-2 border-r-2 border-text-secondary/60 rounded-br" />
      </div>
    </div>
  );
}
