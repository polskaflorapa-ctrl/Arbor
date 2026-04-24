import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import api from '../api';
import { getStoredToken, authHeaders } from '../utils/storedToken';

const PAGE_CONTEXT = {
  '/dashboard': 'Dashboard — przegląd statystyk i szybkich akcji',
  '/zlecenia': 'Lista zleceń',
  '/harmonogram': 'Harmonogram pracy ekip',
  '/wycena-kalendarz': 'Kalendarz wycen',
  '/zatwierdz-wyceny': 'Zatwierdzanie wycen przez kierownika',
  '/kierownik': 'Panel planowania kierownika',
  '/ekipy': 'Zarządzanie ekipami',
  '/flota': 'Flota i sprzęt',
  '/ksiegowosc': 'Księgowość i rozliczenia',
  '/raporty': 'Raporty i statystyki',
  '/uzytkownicy': 'Lista użytkowników',
  '/zarzadzaj-rolami': 'Panel zarządzania rolami',
};

const SUGGESTED = [
  'Ile mamy aktywnych zleceń?',
  'Podsumuj ekipy w systemie',
  'Jakie usługi oferuje firma?',
  'Jak zatwierdza się wycenę?',
];

export default function AiChat() {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [apiKeyMissing, setApiKeyMissing] = useState(false);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  // Scroll do dołu przy nowej wiadomości
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // Focus na input po otwarciu
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 150);
      setMessages((prev) => {
        if (prev.length > 0) return prev;
        return [{
          role: 'assistant',
          content: '👋 Cześć! Jestem asystentem ARBOR-OS. Mogę pomóc z pytaniami o zlecenia, ekipy, wyceny i harmonogram. O co chcesz zapytać?',
        }];
      });
    }
  }, [open]);

  const send = async (text) => {
    const userMsg = text || input.trim();
    if (!userMsg || loading) return;
    setInput('');

    const newMessages = [...messages, { role: 'user', content: userMsg }];
    setMessages(newMessages);
    setLoading(true);

    try {
      const token = getStoredToken();
      const context = PAGE_CONTEXT[location.pathname] || `Strona: ${location.pathname}`;
      const res = await api.post(
        '/ai/chat',
        { messages: newMessages, context },
        { headers: authHeaders(token) }
      );
      setMessages(prev => [...prev, { role: 'assistant', content: res.data.reply }]);
      setApiKeyMissing(false);
    } catch (err) {
      const errMsg = err.response?.data?.error || 'Błąd połączenia z AI';
      if (errMsg.includes('klucz API')) setApiKeyMissing(true);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `❌ ${errMsg}`,
        isError: true,
      }]);
    } finally {
      setLoading(false);
    }
  };

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const clearChat = () => {
    setMessages([{
      role: 'assistant',
      content: '👋 Rozmowa wyczyszczona. Jak mogę pomóc?',
    }]);
  };

  return (
    <>
      {/* Pływający przycisk */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 9000,
          width: 56, height: 56, borderRadius: '50%',
          background: open ? 'var(--bg-card)' : 'linear-gradient(145deg, #059669 0%, #34d399 100%)',
          border: open ? '2px solid #34d399' : 'none',
          cursor: 'pointer', boxShadow: open ? '0 8px 28px rgba(0,0,0,0.45)' : '0 8px 28px rgba(5,150,105,0.35)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'all 0.2s', color: open ? 'var(--text)' : '#fff',
        }}
        title={open ? 'Zamknij asystenta' : 'Asystent AI'}
      >
        {open ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        ) : (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            <circle cx="9" cy="10" r="1" fill="currentColor"/>
            <circle cx="12" cy="10" r="1" fill="currentColor"/>
            <circle cx="15" cy="10" r="1" fill="currentColor"/>
          </svg>
        )}
      </button>

      {/* Panel chatu */}
      {open && (
        <div style={S.panel}>
          {/* Header */}
          <div style={S.header}>
            <div style={S.headerLeft}>
              <div style={S.avatarAi}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#34D399" strokeWidth="2" strokeLinecap="round">
                  <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                  <path d="M2 17l10 5 10-5"/>
                  <path d="M2 12l10 5 10-5"/>
                </svg>
              </div>
              <div>
                <div style={S.headerTitle}>Asystent ARBOR-OS</div>
                <div style={S.headerSub}>
                  <span style={S.dot} />
                  Claude AI · online
                </div>
              </div>
            </div>
            <button onClick={clearChat} style={S.clearBtn} title="Wyczyść rozmowę">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.36"/>
              </svg>
            </button>
          </div>

          {/* Ostrzeżenie brak klucza */}
          {apiKeyMissing && (
            <div style={S.keyWarning}>
              ⚠️ Brak klucza API. Dodaj <code>ANTHROPIC_API_KEY</code> w pliku <code>.env</code> i zrestartuj backend.
            </div>
          )}

          {/* Wiadomości */}
          <div style={S.messages}>
            {messages.map((m, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: 10 }}>
                {m.role === 'assistant' && (
                  <div style={S.aiBubbleIcon}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#34D399" strokeWidth="2.5" strokeLinecap="round">
                      <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                    </svg>
                  </div>
                )}
                <div style={{
                  ...S.bubble,
                  ...(m.role === 'user' ? S.bubbleUser : S.bubbleAi),
                  ...(m.isError ? { borderColor: '#EF4444', color: '#FCA5A5' } : {}),
                }}>
                  {formatMessage(m.content)}
                </div>
              </div>
            ))}

            {loading && (
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, marginBottom: 10 }}>
                <div style={S.aiBubbleIcon}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#34D399" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                  </svg>
                </div>
                <div style={S.bubbleAi}>
                  <TypingDots />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Sugestie — widoczne tylko na początku */}
          {messages.length <= 1 && (
            <div style={S.suggestions}>
              {SUGGESTED.map(s => (
                <button key={s} style={S.suggBtn} onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <div style={S.inputRow}>
            <textarea
              ref={inputRef}
              style={S.input}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Zadaj pytanie... (Enter = wyślij)"
              rows={1}
              disabled={loading}
            />
            <button
              style={{ ...S.sendBtn, opacity: (!input.trim() || loading) ? 0.4 : 1 }}
              onClick={() => send()}
              disabled={!input.trim() || loading}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="22" y1="2" x2="11" y2="13"/>
                <polygon points="22 2 15 22 11 13 2 9 22 2"/>
              </svg>
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// ── Formatowanie markdown-lite ─────────────────────────────────────────────────
function formatMessage(text) {
  const lines = text.split('\n');
  return lines.map((line, i) => {
    if (line.startsWith('**') && line.endsWith('**')) {
      return <div key={i} style={{ fontWeight: 700, marginTop: i > 0 ? 6 : 0 }}>{line.slice(2, -2)}</div>;
    }
    if (line.startsWith('- ') || line.startsWith('• ')) {
      return <div key={i} style={{ paddingLeft: 12, marginTop: 2 }}>· {line.slice(2)}</div>;
    }
    if (line === '') return <div key={i} style={{ height: 6 }} />;
    // Bold inline
    const parts = line.split(/\*\*(.*?)\*\*/g);
    return (
      <div key={i} style={{ marginTop: i > 0 && lines[i-1] !== '' ? 2 : 0 }}>
        {parts.map((p, j) => j % 2 === 1 ? <strong key={j}>{p}</strong> : p)}
      </div>
    );
  });
}

function TypingDots() {
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center', padding: '2px 0' }}>
      {[0, 1, 2].map(i => (
        <div key={i} style={{
          width: 6, height: 6, borderRadius: '50%', backgroundColor: '#34D399',
          animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
          opacity: 0.7,
        }} />
      ))}
      <style>{`@keyframes pulse { 0%,80%,100%{transform:scale(0.7);opacity:0.4} 40%{transform:scale(1);opacity:1} }`}</style>
    </div>
  );
}

// ── Style ──────────────────────────────────────────────────────────────────────
const S = {
  panel: {
    position: 'fixed', bottom: 92, right: 24, zIndex: 8999,
    width: 380, height: 520,
    backgroundColor: 'var(--bg-card)',
    border: '1px solid var(--border)',
    borderRadius: 20, boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
    animation: 'slideUp 0.2s ease',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '14px 16px', borderBottom: '1px solid var(--border)',
    background: 'linear-gradient(135deg, rgba(52,211,153,0.08), transparent)',
  },
  headerLeft: { display: 'flex', alignItems: 'center', gap: 10 },
  avatarAi: {
    width: 34, height: 34, borderRadius: 10,
    background: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.25)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 14, fontWeight: 700, color: 'var(--text, #E2E8F0)' },
  headerSub: { fontSize: 11, color: '#34D399', display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 },
  dot: { width: 6, height: 6, borderRadius: '50%', backgroundColor: '#34D399', display: 'inline-block' },
  clearBtn: {
    background: 'none', border: '1px solid var(--border, #1E3A5F)', borderRadius: 8,
    color: 'var(--text-muted, #64748B)', cursor: 'pointer', padding: '5px 8px',
    display: 'flex', alignItems: 'center',
  },
  keyWarning: {
    margin: '8px 12px 0', padding: '8px 12px', borderRadius: 8,
    backgroundColor: '#451A03', color: '#FCD34D', fontSize: 12, lineHeight: 1.5,
  },
  messages: {
    flex: 1, overflowY: 'auto', padding: '12px 14px',
    display: 'flex', flexDirection: 'column',
  },
  bubble: {
    maxWidth: '82%', padding: '9px 13px', borderRadius: 14,
    fontSize: 13, lineHeight: 1.55,
    borderWidth: 1, borderStyle: 'solid', borderColor: 'transparent',
  },
  bubbleUser: {
    backgroundColor: '#34D399', color: '#052E16',
    borderRadius: '14px 14px 4px 14px', fontWeight: 500,
  },
  bubbleAi: {
    backgroundColor: 'var(--bg-deep, #0F172A)',
    color: 'var(--text, #E2E8F0)',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'var(--border, #1E3A5F)',
    borderRadius: '14px 14px 14px 4px',
  },
  aiBubbleIcon: {
    width: 24, height: 24, borderRadius: 8, flexShrink: 0, alignSelf: 'flex-end',
    background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.2)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: 6,
  },
  suggestions: {
    display: 'flex', flexWrap: 'wrap', gap: 6, padding: '0 12px 10px',
  },
  suggBtn: {
    background: 'var(--bg-deep, #0F172A)', border: '1px solid var(--border, #1E3A5F)',
    borderRadius: 20, color: 'var(--text-sub, #94A3B8)', fontSize: 11,
    padding: '5px 10px', cursor: 'pointer', transition: 'all 0.15s',
  },
  inputRow: {
    display: 'flex', gap: 8, padding: '10px 12px',
    borderTop: '1px solid var(--border, #1E3A5F)',
    background: 'var(--bg-card, #1E293B)',
  },
  input: {
    flex: 1, backgroundColor: 'var(--bg-deep, #0F172A)',
    border: '1px solid var(--border, #1E3A5F)', borderRadius: 12,
    color: 'var(--text, #E2E8F0)', fontSize: 13, padding: '9px 12px',
    resize: 'none', outline: 'none', fontFamily: 'inherit', lineHeight: 1.4,
  },
  sendBtn: {
    width: 38, height: 38, borderRadius: 10, flexShrink: 0,
    background: '#34D399', border: 'none', cursor: 'pointer',
    color: '#052E16', display: 'flex', alignItems: 'center', justifyContent: 'center',
    transition: 'opacity 0.15s',
  },
};
