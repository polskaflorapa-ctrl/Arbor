import { useNavigate, useLocation } from 'react-router-dom';
import { useEffect, useState, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../api';
import { getRolaColor } from '../theme';
import { useTheme, THEMES } from '../ThemeContext';
import LanguageSwitcher from './LanguageSwitcher';
import { readStoredUser } from '../utils/readStoredUser';
import { getStoredToken, authHeaders } from '../utils/storedToken';

// ─── Stałe ───────────────────────────────────────────────────────────────────
const NOTIF_KOLOR = {
  problem: '#F87171', potrzebuje_czasu: '#FBBF24', skonczylem_wczesniej: 'var(--accent)',
  pytanie: '#60A5FA', info: '#94A3B8', nowe_zlecenie: '#A78BFA',
  potwierdzenie_godzin: 'var(--accent)', delegacja: '#FBBF24', przypomnienie: '#F87171',
};
// SVG ikony nawigacji
const ICONS = {
  dashboard:    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>,
  zlecenia:     <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="13" y2="16"/></svg>,
  harmonogram:  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
  kierownik:    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>,
  ekipy:        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  flota:        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="1" y="3" width="15" height="13" rx="2"/><path d="M16 8h4l3 5v3h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>,
  ksiegowosc:   <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>,
  raporty:      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
  uzytkownicy:  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  oddzialy:     <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
  wyceny:       <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>,
  klienci:      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
  ogledziny:    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
  telefonia:    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.62 3.33 2 2 0 0 1 3.18 1h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.1 9a16 16 0 0 0 6.9 6.9l1.36-1.35a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>,
  integracje:   <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M9 18l6-6-6-6"/><path d="M3 12h12"/><path d="M21 5v14"/></svg>,
  bell:         <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>,
  logout:       <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>,
  collapse:     <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>,
  expand:       <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>,
};

export default function Sidebar() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [notifCount, setNotifCount] = useState(0);
  const [showNotif, setShowNotif] = useState(false);
  const [notifList, setNotifList] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [collapsed, setCollapsed] = useState(false);
  const [hovered, setHovered] = useState(null);
  const notifRef = useRef(null);
  const { themeId, setTheme } = useTheme();

  useEffect(() => {
    const u = readStoredUser();
    if (u) setCurrentUser(u);
    loadNotifications();
    const iv = setInterval(loadNotifications, 30000);
    const onOutside = (e) => { if (notifRef.current && !notifRef.current.contains(e.target)) setShowNotif(false); };
    const onKey = (e) => { if (e.key === 'Escape') setShowNotif(false); };
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('keydown', onKey);
    return () => { clearInterval(iv); document.removeEventListener('mousedown', onOutside); document.removeEventListener('keydown', onKey); };
  }, []);

  const links = useMemo(() => {
    const ADMIN   = ['Dyrektor', 'Administrator'];
    const MGMT    = ['Dyrektor', 'Administrator', 'Kierownik'];
    const WORKERS = ['Dyrektor', 'Administrator', 'Kierownik', 'Brygadzista', 'Specjalista', 'Pomocnik', 'Pomocnik bez doświadczenia'];
    const ALL     = ['Dyrektor', 'Administrator', 'Kierownik', 'Brygadzista', 'Specjalista', 'Pomocnik', 'Pomocnik bez doświadczenia', 'Wyceniający', 'Magazynier'];
    const all = [
      { path: '/dashboard',         labelKey: 'nav.dashboard',       icon: 'dashboard',   roles: ALL },
      { path: '/zlecenia',          labelKey: 'nav.orders',          icon: 'zlecenia',    roles: [...WORKERS, 'Magazynier'] },
      { path: '/harmonogram',       labelKey: 'nav.schedule',      icon: 'harmonogram', roles: [...MGMT, 'Brygadzista', 'Specjalista', 'Magazynier'] },
      { path: '/wycena-kalendarz',  labelKey: 'nav.quotes',          icon: 'wyceny',      roles: ['Wyceniający', 'Specjalista', ...MGMT] },
      { path: '/zatwierdz-wyceny',  labelKey: 'nav.approveQuotes',   icon: 'wyceny',      roles: MGMT },
      { path: '/klienci',           labelKey: 'nav.clients',       icon: 'klienci',     roles: MGMT },
      { path: '/ogledziny',         labelKey: 'nav.inspections',   icon: 'ogledziny',   roles: [...MGMT, 'Specjalista'] },
      { path: '/telefonia',         labelKey: 'nav.telephony',     icon: 'telefonia',   roles: MGMT },
      { path: '/integracje',        labelKey: 'nav.integrations',  icon: 'integracje',  roles: MGMT },
      { path: '/wynagrodzenie-wyceniajacych', labelKey: 'nav.estimatorPayout', icon: 'ksiegowosc', roles: ['Dyrektor', 'Administrator', 'Kierownik', 'Wyceniający'] },
      { path: '/kierownik',         labelKey: 'nav.planning',      icon: 'kierownik',   roles: MGMT },
      { path: '/ekipy',             labelKey: 'nav.teams',         icon: 'ekipy',       roles: MGMT },
      { path: '/flota',             labelKey: 'nav.fleet',         icon: 'flota',       roles: [...MGMT, 'Brygadzista', 'Magazynier'] },
      { path: '/ksiegowosc',        labelKey: 'nav.accounting',    icon: 'ksiegowosc',  roles: MGMT },
      { path: '/raporty',           labelKey: 'nav.reports',       icon: 'raporty',     roles: [...MGMT, 'Brygadzista', 'Specjalista'] },
      { path: '/uzytkownicy',       labelKey: 'nav.users',         icon: 'uzytkownicy', roles: ADMIN },
      { path: '/oddzialy',          labelKey: 'nav.branches',      icon: 'oddzialy',    roles: ADMIN },
      { path: '/zarzadzaj-rolami',  labelKey: 'nav.roles',         icon: 'uzytkownicy', roles: ADMIN },
    ];
    return currentUser ? all.filter(l => l.roles.includes(currentUser.rola)) : all;
  }, [currentUser]);

  const loadNotifications = async () => {
    try {
      const token = getStoredToken();
      const res = await api.get('/notifications', { headers: authHeaders(token) });
      const data = res.data;
      const list = data.notifications || data || [];
      setNotifList(Array.isArray(list) ? list : []);
      setNotifCount(data.unread_count || (Array.isArray(list) ? list.filter(n => n.status === 'Nowe').length : 0));
    } catch { /* ignoruj */ }
  };

  const markAll = async () => {
    try {
      const token = getStoredToken();
      await api.put('/notifications/odczytaj-wszystkie', {}, { headers: authHeaders(token) });
      loadNotifications();
    } catch { /* ignoruj */ }
  };
  const markOne = async (id) => {
    try {
      const token = getStoredToken();
      await api.put(`/notifications/${id}/odczytaj`, {}, { headers: authHeaders(token) });
      loadNotifications();
    } catch { /* ignoruj */ }
  };
  const handleLogout = () => { localStorage.clear(); navigate('/'); };

  const fmtTime = (d) => {
    if (!d) return '';
    const diff = Math.floor((Date.now() - new Date(d)) / 60000);
    if (diff < 1) return t('time.justNow');
    if (diff < 60) return t('time.minutesAgo', { count: diff });
    if (diff < 1440) return t('time.hoursAgo', { count: Math.floor(diff / 60) });
    const lng = (i18n.language || 'pl').split('-')[0];
    const localeTag = lng === 'uk' ? 'uk-UA' : lng === 'ru' ? 'ru-RU' : 'pl-PL';
    return new Date(d).toLocaleDateString(localeTag);
  };

  const W = collapsed ? 68 : 252;
  const rolaColor = getRolaColor(currentUser?.rola);
  const onActivateKeyDown = (handler) => (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handler();
    }
  };

  return (
    <>
      <div style={{ ...sb.root, width: W }}>

        {/* Przycisk zwijania */}
        <button onClick={() => setCollapsed(!collapsed)} style={sb.collapseBtn} title={collapsed ? t('sidebar.expand') : t('sidebar.collapse')}>
          {collapsed ? ICONS.expand : ICONS.collapse}
        </button>

        {/* Logo */}
        <div style={{ ...sb.logo, justifyContent: collapsed ? 'center' : 'flex-start' }}>
          <div style={{ ...sb.logoIcon, color: 'var(--accent)' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M12 22V12M12 12C12 7 7 3 3 3c0 4 2 8 5 10M12 12C12 7 17 3 21 3c0 4-2 8-5 10"/>
            </svg>
          </div>
          {!collapsed && (
            <div>
              <div style={sb.logoName}>ARBOR-OS</div>
              <div style={sb.logoSub}>{t('sidebar.logoSub')}</div>
            </div>
          )}
        </div>

        {/* Użytkownik */}
        {currentUser && (
          <div style={{ ...sb.userCard, padding: collapsed ? '10px 8px' : '12px 14px' }}>
            <div style={{ ...sb.avatar, background: rolaColor + '33', border: `2px solid ${rolaColor}` }}>
              <span style={{ ...sb.avatarText, color: rolaColor }}>
                {currentUser.imie?.[0]}{currentUser.nazwisko?.[0]}
              </span>
            </div>
            {!collapsed && (
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={sb.userName}>{currentUser.imie} {currentUser.nazwisko}</div>
                <div style={{ ...sb.rolaBadge, background: rolaColor + '22', color: rolaColor }}>
                  {currentUser.rola}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Separator */}
        {!collapsed && <div style={sb.sectionLabel}>{t('sidebar.menu')}</div>}
        <div style={sb.separator} />

        {/* Nawigacja */}
        <nav style={sb.nav}>
          {links.map((link) => {
            const active = location.pathname === link.path || location.pathname.startsWith(link.path + '/');
            const isHov = hovered === link.path;
            return (
              <div key={link.path}
                onClick={() => navigate(link.path)}
                onKeyDown={onActivateKeyDown(() => navigate(link.path))}
                onMouseEnter={() => setHovered(link.path)}
                onMouseLeave={() => setHovered(null)}
                role="button"
                tabIndex={0}
                aria-current={active ? 'page' : undefined}
                title={collapsed ? t(link.labelKey) : ''}
                style={{
                  ...sb.navItem,
                  justifyContent: collapsed ? 'center' : 'flex-start',
                  padding: collapsed ? '10px 0' : '10px 14px',
                  background: active ? 'var(--nav-active-bg)' : isHov ? 'var(--nav-hover-bg)' : 'transparent',
                  color: active ? 'var(--accent)' : isHov ? 'var(--text)' : 'var(--text-sub)',
                  borderLeft: `3px solid ${active ? 'var(--accent)' : 'transparent'}`,
                  fontWeight: active ? 700 : 500,
                }}>
                <span style={{ flexShrink: 0, display: 'flex' }}>{ICONS[link.icon]}</span>
                {!collapsed && <span style={{ marginLeft: 10 }}>{t(link.labelKey)}</span>}
                {!collapsed && active && <span style={sb.activeDot} />}
              </div>
            );
          })}
        </nav>

        {/* Dolna sekcja */}
        <div style={sb.bottom}>
          <div style={sb.separator} />

          {/* Powiadomienia */}
          <div ref={notifRef} style={{ position: 'relative' }}>
            <div
              onClick={() => setShowNotif(!showNotif)}
              onKeyDown={onActivateKeyDown(() => setShowNotif(!showNotif))}
              role="button"
              tabIndex={0}
              aria-label={t('sidebar.notificationsAria')}
              aria-expanded={showNotif}
              style={{
                ...sb.navItem,
                justifyContent: collapsed ? 'center' : 'flex-start',
                padding: collapsed ? '10px 0' : '10px 14px',
                background: showNotif ? 'var(--nav-active-bg)' : 'transparent',
                color: showNotif ? 'var(--accent)' : 'var(--text-sub)',
                borderLeft: `3px solid ${showNotif ? 'var(--accent)' : 'transparent'}`,
                cursor: 'pointer',
              }}>
              <span style={{ flexShrink: 0, display: 'flex', position: 'relative' }}>
                {ICONS.bell}
                {notifCount > 0 && (
                  <span style={sb.badge}>{notifCount > 99 ? '99+' : notifCount}</span>
                )}
              </span>
              {!collapsed && <span style={{ marginLeft: 10, fontWeight: 500, fontSize: 13 }}>{t('sidebar.notifications')}</span>}
              {!collapsed && notifCount > 0 && (
                <span style={{ ...sb.badge, position: 'static', marginLeft: 'auto', borderRadius: 10, padding: '1px 6px' }}>
                  {notifCount}
                </span>
              )}
            </div>

            {/* Dropdown powiadomień */}
            {showNotif && (
              <div style={{ ...sb.notifPanel, left: collapsed ? 80 : 264 }}>
                <div style={sb.notifHeader}>
                  <span style={sb.notifTitle}>{t('sidebar.notifications')}</span>
                  {notifCount > 0 && (
                    <button onClick={markAll} style={sb.markAllBtn}>{t('sidebar.markAllRead')}</button>
                  )}
                </div>
                {notifList.length === 0 ? (
                  <div style={sb.notifEmpty}>
                    <div style={{ fontSize: 32, marginBottom: 8, opacity: 0.4 }}>🔔</div>
                    <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>{t('sidebar.noNotifications')}</p>
                  </div>
                ) : notifList.slice(0, 15).map(n => {
                  const kolor = NOTIF_KOLOR[n.typ] || '#94A3B8';
                  return (
                    <div key={n.id}
                      onClick={() => { if (n.task_id) navigate(`/zlecenia/${n.task_id}`); if (n.status === 'Nowe') markOne(n.id); setShowNotif(false); }}
                      style={{ ...sb.notifItem, background: n.status === 'Nowe' ? 'var(--accent-surface)' : 'transparent' }}>
                      <div style={{ ...sb.notifDot, background: kolor + '33', color: kolor }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                          <circle cx="12" cy="12" r="10"/>
                        </svg>
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={sb.notifTop}>
                          <span style={{ ...sb.notifTyp, color: kolor }}>{t(`notifType.${n.typ}`, { defaultValue: n.typ })}</span>
                          <span style={sb.notifTime}>{fmtTime(n.data_utworzenia)}</span>
                        </div>
                        <div style={sb.notifOd}>{t('sidebar.fromPrefix')} {n.od_kogo || t('sidebar.system')}</div>
                        {n.tresc && <div style={sb.notifTresc}>{n.tresc}</div>}
                      </div>
                      {n.status === 'Nowe' && <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0, marginTop: 4 }} />}
                    </div>
                  );
                })}
                {notifList.length > 15 && (
                  <div style={{ textAlign: 'center', padding: '10px', borderTop: '1px solid var(--border)' }}>
                    <button onClick={() => { navigate('/powiadomienia'); setShowNotif(false); }} style={sb.markAllBtn}>
                      {t('sidebar.seeAll')}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Język */}
          <div style={{ padding: collapsed ? '8px 4px' : '8px 14px', borderTop: '1px solid var(--border)' }}>
            <LanguageSwitcher
              compact={collapsed}
              style={{
                justifyContent: collapsed ? 'center' : 'flex-start',
                width: collapsed ? '100%' : 'auto',
              }}
            />
          </div>

          {/* Wybór motywu */}
          <div style={{
            padding: collapsed ? '8px 4px' : '8px 14px',
            display: 'flex',
            flexDirection: collapsed ? 'column' : 'row',
            alignItems: 'center',
            gap: 8,
            marginBottom: 4,
          }}>
            {!collapsed && (
              <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: 1, marginRight: 'auto' }}>{t('sidebar.theme')}</span>
            )}
            {Object.values(THEMES).map((th) => (
              <button
                key={th.id}
                title={th.label}
                type="button"
                onClick={() => setTheme(th.id)}
                style={{
                  width: 18, height: 18, borderRadius: '50%',
                  background: th.previewDot,
                  border: themeId === th.id ? `2px solid var(--accent)` : '2px solid transparent',
                  cursor: 'pointer',
                  boxShadow: themeId === th.id ? `0 0 8px ${th.previewDot}88` : 'none',
                  outline: 'none',
                  transition: 'all 0.2s',
                  flexShrink: 0,
                  padding: 0,
                }}
              />
            ))}
          </div>

          {/* Wyloguj */}
          <div
            onClick={handleLogout}
            onKeyDown={onActivateKeyDown(handleLogout)}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(248,113,113,0.1)'; e.currentTarget.style.color = '#F87171'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#64748B'; }}
            role="button"
            tabIndex={0}
            aria-label={t('sidebar.logoutAria')}
            style={{
              ...sb.navItem, justifyContent: collapsed ? 'center' : 'flex-start',
              padding: collapsed ? '10px 0' : '10px 14px',
              color: 'var(--text-muted)', cursor: 'pointer', transition: 'all 0.15s',
              borderLeft: '3px solid transparent',
            }}>
            <span style={{ display: 'flex', flexShrink: 0 }}>{ICONS.logout}</span>
            {!collapsed && <span style={{ marginLeft: 10, fontSize: 13, fontWeight: 500 }}>{t('sidebar.logout')}</span>}
          </div>
        </div>
      </div>

      {/* Spacer */}
      <div style={{ width: W, flexShrink: 0, transition: 'width 0.25s ease' }} />
    </>
  );
}

// ─── Style ────────────────────────────────────────────────────────────────────
const sb = {
  root: {
    height: '100vh', position: 'fixed', left: 0, top: 0, zIndex: 200,
    background: 'var(--sidebar)', display: 'flex', flexDirection: 'column',
    borderRight: '1px solid var(--border)', transition: 'width 0.25s ease',
    overflow: 'hidden',
  },
  collapseBtn: {
    position: 'absolute', right: -12, top: 28, width: 24, height: 24,
    borderRadius: '50%', background: 'var(--bg-card)',
    borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border2)',
    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: 'var(--text-sub)', zIndex: 201, boxShadow: 'var(--shadow-sm)',
    transition: 'all 0.15s',
  },
  logo: {
    display: 'flex', alignItems: 'center', gap: 12,
    padding: '20px 16px 16px', borderBottom: '1px solid var(--border)',
  },
  logoIcon: {
    width: 38, height: 38, borderRadius: 10, background: 'var(--logo-tint-bg)',
    borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--logo-tint-border)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  logoName: { fontSize: 16, fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.3px' },
  logoSub: { fontSize: 9, color: 'var(--accent)', letterSpacing: 1.5, marginTop: 2, fontWeight: 600 },
  userCard: {
    display: 'flex', alignItems: 'center', gap: 10, margin: '12px 12px 4px',
    background: 'var(--bg-deep)', borderRadius: 12,
    borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border)',
  },
  avatar: {
    width: 36, height: 36, borderRadius: 10, display: 'flex', alignItems: 'center',
    justifyContent: 'center', flexShrink: 0,
  },
  avatarText: { fontSize: 13, fontWeight: 800 },
  userName: { fontSize: 13, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  rolaBadge: { fontSize: 10, fontWeight: 700, borderRadius: 6, padding: '2px 8px', display: 'inline-block', marginTop: 3 },
  sectionLabel: { fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, letterSpacing: 1.5, padding: '12px 16px 4px' },
  separator: { height: 1, background: 'var(--border)', margin: '4px 12px' },
  nav: { flex: 1, minHeight: 0, padding: '4px 8px', overflowY: 'auto' },
  navItem: {
    display: 'flex', alignItems: 'center', borderRadius: 10, cursor: 'pointer',
    fontSize: 13, fontWeight: 500, transition: 'background 0.15s ease, color 0.15s ease, border-color 0.15s ease',
    marginBottom: 2, userSelect: 'none',
  },
  activeDot: { marginLeft: 'auto', width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)' },
  bottom: { padding: '4px 8px 16px', flexShrink: 0 },
  badge: {
    position: 'absolute', top: -4, right: -4, background: '#EF4444', color: '#fff',
    borderRadius: '50%', minWidth: 16, height: 16, fontSize: 10, fontWeight: 700,
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 2px',
  },
  notifPanel: {
    position: 'fixed', bottom: 80, width: 340, background: 'var(--bg-card)',
    borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border)', borderRadius: 16,
    boxShadow: 'var(--shadow-lg)',
    zIndex: 1000, maxHeight: 460, overflowY: 'auto',
  },
  notifHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '14px 16px', borderBottom: '1px solid var(--border)',
    position: 'sticky', top: 0, background: 'var(--bg-card)', zIndex: 1,
  },
  notifTitle: { fontSize: 14, fontWeight: 700, color: 'var(--text)' },
  markAllBtn: { fontSize: 12, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 },
  notifEmpty: { padding: '32px 24px', textAlign: 'center' },
  notifItem: {
    display: 'flex', gap: 10, padding: '12px 14px', borderBottom: '1px solid var(--border)',
    cursor: 'pointer', transition: 'background 0.15s',
  },
  notifDot: { width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  notifTop: { display: 'flex', justifyContent: 'space-between', marginBottom: 2 },
  notifTyp: { fontSize: 11, fontWeight: 700, textTransform: 'uppercase' },
  notifTime: { fontSize: 10, color: 'var(--text-muted)' },
  notifOd: { fontSize: 12, color: 'var(--text-sub)', marginBottom: 2 },
  notifTresc: { fontSize: 12, color: 'var(--text-sub)', lineHeight: 1.45 },
};
