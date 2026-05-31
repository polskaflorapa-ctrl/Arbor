import { useNavigate, useLocation } from 'react-router-dom';
import { useEffect, useState, useRef, useMemo, Fragment, useCallback } from 'react';
import { useSSE } from '../hooks/useSSE';
import { useTranslation } from 'react-i18next';
import api from '../api';
import { getRolaColor } from '../theme';
import { readStoredUser } from '../utils/readStoredUser';
import { getRoleDisplayName, hasAnyRole } from '../utils/roleDisplay';
import { getStoredToken, authHeaders } from '../utils/storedToken';
import { clearAuthSession } from '../utils/authSession';
// ─── Stałe ───────────────────────────────────────────────────────────────────
const NOTIF_KOLOR = {
  problem: '#F87171', potrzebuje_czasu: '#FBBF24', skonczylem_wczesniej: 'var(--accent)',
  pytanie: '#60A5FA', info: '#94A3B8', nowe_zlecenie: 'var(--accent)',
  potwierdzenie_godzin: 'var(--accent)', raport_dnia_ekipy: 'var(--accent)', kasa_oddzial_nieodebrana: '#F87171',
  delegacja: '#FBBF24', przypomnienie: '#F87171',
  'Odprawa ekipy': '#0f766e', 'Przypomnienie odprawy': '#b45309',
};
// SVG ikony nawigacji
const ICONS = {
  dashboard:    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>,
  explore:      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>,
  mission:      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/><path d="M6 19h4"/></svg>,
  autoplan:     <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 15c4-8 12-8 16 0"/><path d="M8 15c2-4 6-4 8 0"/><circle cx="12" cy="16" r="2"/><path d="M12 4v3"/><path d="M4.9 6.9l2.1 2.1"/><path d="M19.1 6.9 17 9"/></svg>,
  zlecenia:     <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="13" y2="16"/></svg>,
  harmonogram:  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
  kierownik:    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>,
  liveMap:      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="M12 3v3"/><path d="M12 18v3"/><path d="M3 12h3"/><path d="M18 12h3"/></svg>,
  dispatch:     <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/></svg>,
  bi:           <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><path d="M2 20h20"/></svg>,
  ekipy:        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  flota:        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="1" y="3" width="15" height="13" rx="2"/><path d="M16 8h4l3 5v3h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>,
  warehouse:    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>,
  equipmentRes: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><circle cx="8" cy="15" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="15" r="1" fill="currentColor" stroke="none"/><circle cx="16" cy="15" r="1" fill="currentColor" stroke="none"/></svg>,
  resourceCal:  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><rect x="6" y="14" width="5" height="3" rx="1" fill="currentColor" stroke="none"/><rect x="13" y="14" width="5" height="3" rx="1" fill="currentColor" stroke="none" opacity=".5"/></svg>,
  crewAttendance: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/><path d="M19 10l2 2 4-4" stroke="currentColor" strokeWidth="2"/></svg>,
  ksiegowosc:   <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>,
  raporty:      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
  uzytkownicy:  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  oddzialy:     <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
  wyceny:       <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>,
  calendarBlocks: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><path d="M8 16h.01M12 16h.01M16 16h.01" strokeWidth="2.5"/></svg>,
  approveNav: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>,
  klienci:      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
  crm:          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>,
  ogledziny:    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
  telefonia:    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.62 3.33 2 2 0 0 1 3.18 1h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.1 9a16 16 0 0 0 6.9 6.9l1.36-1.35a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>,
  integracje:   <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M9 18l6-6-6-6"/><path d="M3 12h12"/><path d="M21 5v14"/></svg>,
  bell:         <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>,
  profil:       <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 20v-1a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v1"/></svg>,
  plus:         <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
  logout:       <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>,
  collapse:     <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>,
  expand:       <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>,
};

function NavChevron() {
  return null;
}

function isRouteBriefNotification(notification = {}) {
  return notification.typ === 'Odprawa ekipy' && notification.dispatch_route_brief_id;
}

const NAV_GROUPS = [
  { key: 'start', label: 'Start', moreLabel: 'Profil i zadania' },
  { key: 'sales', label: 'Sprzedaż i oględziny', moreLabel: 'CRM, klienci i wyceny' },
  { key: 'planning', label: 'Planowanie', moreLabel: 'Harmonogram i dispatch' },
  { key: 'execution', label: 'Ekipy i wykonanie', moreLabel: 'Teren, sprzęt i magazyn' },
  { key: 'company', label: 'Firma', moreLabel: 'Kadry, oddziały i finanse' },
  { key: 'reports', label: 'Raporty', moreLabel: 'Analityka i rankingi' },
];

const NAV_GROUP_BY_PATH = {
  '/dashboard': 'start',
  '/eksploruj': 'start',
  '/profil': 'start',
  '/zadania': 'start',
  '/raporty': 'reports',
  '/zlecenia': 'planning',
  '/harmonogram': 'planning',
  '/kierownik': 'planning',
  '/kontrola-operacyjna': 'reports',
  '/auto-dispatch': 'planning',
  '/mapa-live': 'planning',
  '/bi': 'reports',
  '/hr': 'company',
  '/ekipy': 'execution',
  '/wyceniajacy-hub': 'sales',
  '/crm': 'sales',
  '/wycena-kalendarz': 'sales',
  '/blokady-kalendarza': 'sales',
  '/zatwierdz-wyceny': 'sales',
  '/wyceny-terenowe': 'sales',
  '/klienci': 'sales',
  '/telefonia': 'sales',
  '/integracje': 'company',
  '/zgloszenia-demo': 'company',
  '/kadry-dokumenty': 'company',
  '/rozliczenia-ekip': 'company',
  '/rozliczenia-polowe': 'execution',
  '/wynagrodzenie-wyceniajacych': 'company',
  '/ksiegowosc': 'company',
  '/flota': 'execution',
  '/magazyn': 'execution',
  '/rezerwacje-sprzetu': 'execution',
  '/kalendarz-zasobow': 'planning',
  '/potwierdzenia-ekip': 'execution',
  '/ranking-brygad': 'reports',
  '/uzytkownicy': 'company',
  '/oddzialy': 'company',
  '/zarzadzaj-rolami': 'company',
};

const CORE_NAV_PATHS = new Set([
  '/dashboard',
  '/crm',
  '/zlecenia',
  '/harmonogram',
  '/ekipy',
  '/flota',
  '/kadry-dokumenty',
  '/raporty',
]);

function isPrimaryNavPath(path, role) {
  if (CORE_NAV_PATHS.has(path)) return true;
  const normalizedRole = String(role || '').toLowerCase();
  const rolePrimary = new Set();
  if (normalizedRole.includes('wyceniaj') || normalizedRole.includes('specjal')) {
    rolePrimary.add('/wyceniajacy-hub');
    rolePrimary.add('/wyceny-terenowe');
  }
  if (normalizedRole.includes('magazyn')) {
    rolePrimary.add('/magazyn');
    rolePrimary.add('/rezerwacje-sprzetu');
  }
  if (normalizedRole.includes('prezes') || normalizedRole.includes('dyrektor')) {
    rolePrimary.add('/bi');
    rolePrimary.add('/kontrola-operacyjna');
  }
  if (normalizedRole.includes('administrator')) {
    rolePrimary.add('/uzytkownicy');
    rolePrimary.add('/oddzialy');
  }
  return rolePrimary.has(path);
}

const COLLAPSED_NAV_PATHS = new Set([
  '/dashboard',
  '/crm',
  '/zlecenia',
  '/harmonogram',
  '/ekipy',
  '/raporty',
  '/profil',
]);

function groupLinks(links) {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: links.filter((link) => (NAV_GROUP_BY_PATH[link.path] || 'start') === group.key),
  })).map((group) => {
    const primaryItems = group.items.filter((link) => link.primary !== false);
    const secondaryItems = group.items.filter((link) => link.primary === false);
    return {
      ...group,
      primaryItems,
      secondaryItems,
    };
  }).filter((group) => group.items.length > 0);
}

function isActivePath(currentPath, linkPath) {
  return currentPath === linkPath || currentPath.startsWith(`${linkPath}/`);
}

export default function Sidebar() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [notifCount, setNotifCount] = useState(0);
  const [showNotif, setShowNotif] = useState(false);
  const [notifList, setNotifList] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [oddzialy, setOddzialy] = useState([]);
  const [collapsed, setCollapsed] = useState(() => (typeof window !== 'undefined' ? window.innerWidth < 760 : false));
  const [hovered, setHovered] = useState(null);
  const notifRef = useRef(null);
  const notificationsInFlightRef = useRef(false);

  useEffect(() => {
    const u = readStoredUser();
    if (u) setCurrentUser(u);
    loadNotifications();
    loadBranches();
    // Fallback poll every 5 min — SSE handles real-time updates below
    const iv = setInterval(loadNotifications, 5 * 60_000);
    const onOutside = (e) => { if (notifRef.current && !notifRef.current.contains(e.target)) setShowNotif(false); };
    const onKey = (e) => { if (e.key === 'Escape') setShowNotif(false); };
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('keydown', onKey);
    return () => { clearInterval(iv); document.removeEventListener('mousedown', onOutside); document.removeEventListener('keydown', onKey); };
  }, []);

  // SSE: real-time push from server — immediately refresh on new notification
  const handleSSE = useCallback((event) => {
    if (event.event === 'notification') {
      // Optimistically bump count + re-fetch list
      setNotifCount(c => c + 1);
      loadNotifications();
    } else if (event.event === 'task_update') {
      // Could trigger a task list refresh on pages that care — here just a count nudge
      loadNotifications();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useSSE(handleSSE);

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth < 760) setCollapsed(true);
    };
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const links = useMemo(() => {
    const ADMIN   = ['Prezes', 'Dyrektor', 'Administrator'];
    const MGMT    = ['Prezes', 'Dyrektor', 'Administrator', 'Kierownik', 'Dyspozytor'];
    const WORKERS = ['Prezes', 'Dyrektor', 'Administrator', 'Kierownik', 'Dyspozytor', 'Brygadzista', 'Specjalista', 'Pomocnik', 'Pomocnik bez doświadczenia'];
    const FIELD_OPS = ['Prezes', 'Dyrektor', 'Administrator', 'Kierownik', 'Dyspozytor', 'Brygadzista', 'Specjalista', 'Pomocnik', 'Pomocnik bez doświadczenia'];
    const ALL     = ['Prezes', 'Dyrektor', 'Administrator', 'Kierownik', 'Dyspozytor', 'Handlowiec', 'Pracownik biurowy', 'Brygadzista', 'Specjalista', 'Pomocnik', 'Pomocnik bez doświadczenia', 'Wyceniający', 'Magazynier'];
    const all = [
      { path: '/dashboard',         labelKey: 'nav.dashboard',       icon: 'dashboard',   roles: ALL },
      { path: '/eksploruj',        labelKey: 'nav.explore',         icon: 'explore',     roles: ALL },
      { path: '/profil',           labelKey: 'nav.profile',          icon: 'profil',      roles: ALL },
      { path: '/zadania',          labelKey: 'nav.todos',            icon: 'zlecenia',    roles: ALL },
      { path: '/kadry-dokumenty',  labelKey: 'nav.hrDocuments',      icon: 'uzytkownicy', roles: MGMT },
      { path: '/wyceniajacy-hub', labelKey: 'nav.estimatorHub',     icon: 'wyceny',       roles: ['Dyrektor', 'Administrator', 'Kierownik', 'Dyspozytor', 'Wyceniający', 'Specjalista', 'Handlowiec'] },
      { path: '/crm',               labelKey: 'nav.crm',           icon: 'crm',         roles: [...MGMT, 'Wyceniający', 'Specjalista', 'Handlowiec'] },
      { path: '/zlecenia',          labelKey: 'nav.orders',          icon: 'zlecenia',    roles: [...WORKERS, 'Handlowiec', 'Pracownik biurowy', 'Magazynier'] },
      { path: '/harmonogram',       labelKey: 'nav.schedule',      icon: 'harmonogram', roles: [...MGMT, 'Brygadzista', 'Specjalista', 'Pracownik biurowy', 'Magazynier'] },
      { path: '/wycena-kalendarz',  labelKey: 'nav.quotes',          icon: 'wyceny',      roles: ['Wyceniający', 'Specjalista', 'Handlowiec', ...MGMT] },
      { path: '/blokady-kalendarza', labelKey: 'nav.calendarBlocks', icon: 'calendarBlocks', roles: ['Wyceniający', 'Specjalista', 'Handlowiec', ...MGMT] },
      { path: '/zatwierdz-wyceny',  labelKey: 'nav.approveQuotes',   icon: 'approveNav',   roles: ['Kierownik', 'Dyspozytor', 'Administrator', 'Dyrektor', 'Specjalista'] },
      { path: '/wyceny-terenowe',   labelKey: 'nav.fieldQuotes',     icon: 'wyceny',      roles: ['Wyceniający', 'Kierownik', 'Dyspozytor', 'Dyrektor', 'Administrator', 'Specjalista', 'Handlowiec'] },
      { path: '/klienci',           labelKey: 'nav.clients',       icon: 'klienci',     roles: [...MGMT, 'Handlowiec'] },
      { path: '/telefonia',         labelKey: 'nav.telephony',     icon: 'telefonia',   roles: MGMT },
      { path: '/integracje',        labelKey: 'nav.integrations',  icon: 'integracje',  roles: MGMT },
      { path: '/zgloszenia-demo',   labelKey: 'nav.demoRequests',  icon: 'klienci',     roles: ADMIN },
      { path: '/wynagrodzenie-wyceniajacych', labelKey: 'nav.estimatorPayout', icon: 'ksiegowosc', roles: ['Prezes', 'Dyrektor', 'Kierownik', 'Wyceniający'] },
      { path: '/rozliczenia-ekip',    labelKey: 'nav.payrollTeams',   icon: 'ksiegowosc',  roles: ['Prezes', 'Dyrektor', 'Kierownik'] },
      { path: '/rozliczenia-polowe', labelKey: 'nav.fieldSettlements', icon: 'raporty',   roles: ['Dyrektor', 'Administrator', 'Kierownik', 'Brygadzista'] },
      { path: '/kierownik',         labelKey: 'nav.planning',      icon: 'kierownik',   roles: MGMT },
      { path: '/kontrola-operacyjna', labelKey: 'nav.operationalControl', icon: 'raporty', roles: ADMIN },
      { path: '/auto-dispatch',     labelKey: 'nav.autoDispatch',  icon: 'dispatch',    roles: MGMT },
      { path: '/mapa-live',         labelKey: 'nav.liveMap',       icon: 'liveMap',     roles: MGMT, primary: false },
      { path: '/bi',                labelKey: 'nav.bi',            icon: 'bi',          roles: MGMT },
      { path: '/hr',                labelKey: 'nav.hr',            icon: 'uzytkownicy', roles: MGMT },
      { path: '/ekipy',             labelKey: 'nav.teams',         icon: 'ekipy',       roles: MGMT },
      { path: '/potwierdzenia-ekip', labelKey: 'nav.crewAttendance', icon: 'crewAttendance', roles: ALL },
      { path: '/ranking-brygad',    labelKey: 'nav.teamRanking',   icon: 'raporty',     roles: MGMT },
      { path: '/flota',             labelKey: 'nav.fleet',         icon: 'flota',       roles: [...MGMT, 'Brygadzista', 'Magazynier'] },
      { path: '/magazyn',           labelKey: 'nav.warehouse',   icon: 'warehouse',   roles: [...MGMT, 'Brygadzista', 'Magazynier'] },
      { path: '/rezerwacje-sprzetu', labelKey: 'nav.equipmentReservations', icon: 'equipmentRes', roles: [...MGMT, 'Brygadzista', 'Magazynier'] },
      { path: '/kalendarz-zasobow',  labelKey: 'nav.resourceCalendar',      icon: 'resourceCal',  roles: [...MGMT, 'Brygadzista', 'Magazynier'] },
      { path: '/ksiegowosc',        labelKey: 'nav.accounting',    icon: 'ksiegowosc',  roles: MGMT },
      { path: '/raporty',           labelKey: 'nav.reports',       icon: 'raporty',     roles: FIELD_OPS },
      { path: '/uzytkownicy',       labelKey: 'nav.users',         icon: 'uzytkownicy', roles: ADMIN },
      { path: '/oddzialy',          labelKey: 'nav.branches',      icon: 'oddzialy',    roles: ADMIN },
      { path: '/zarzadzaj-rolami',  labelKey: 'nav.roles',         icon: 'uzytkownicy', roles: ADMIN },
    ];
    if (!currentUser?.rola) return [];
    return all
      .filter(l => hasAnyRole(currentUser.rola, l.roles))
      .map((link) => ({
        ...link,
        primary: link.primary === false ? false : isPrimaryNavPath(link.path, currentUser.rola),
      }));
  }, [currentUser]);

  const groupedLinks = useMemo(() => groupLinks(links), [links]);
  const collapsedLinks = useMemo(() => (
    links.filter((link) => COLLAPSED_NAV_PATHS.has(link.path) || isActivePath(location.pathname, link.path))
  ), [links, location.pathname]);

  const loadNotifications = async () => {
    if (notificationsInFlightRef.current) return;
    notificationsInFlightRef.current = true;
    try {
      const token = getStoredToken();
      const res = await api.get('/notifications', { headers: authHeaders(token) });
      const data = res.data;
      const list = data.notifications || data || [];
      setNotifList(Array.isArray(list) ? list : []);
      setNotifCount(data.unread_count || (Array.isArray(list) ? list.filter(n => n.status === 'Nowe').length : 0));
    } catch { /* ignoruj */ }
    finally {
      notificationsInFlightRef.current = false;
    }
  };

  const loadBranches = async () => {
    try {
      const token = getStoredToken();
      const res = await api.get('/oddzialy', { headers: authHeaders(token) });
      const raw = res.data;
      setOddzialy(Array.isArray(raw) ? raw : raw?.oddzialy || []);
    } catch {
      setOddzialy([]);
    }
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
  const openNotification = (notification) => {
    if (isRouteBriefNotification(notification)) {
      navigate('/powiadomienia');
      setShowNotif(false);
      return;
    }
    if (notification.task_id) navigate(`/zlecenia/${notification.task_id}`);
    if (notification.status === 'Nowe') markOne(notification.id);
    setShowNotif(false);
  };
  const handleLogout = () => { clearAuthSession(); navigate('/'); };
  const role = currentUser?.rola;
  const canCreateQuickActions = [
    'Prezes',
    'Dyrektor',
    'Administrator',
    'Kierownik',
    'Dyrektor Sprzedazy',
    'Dyrektor Sprzedaży',
    'Dyrektor dzialu sprzedaz',
    'Dyrektor działu sprzedaż',
  ].some((expectedRole) => hasAnyRole(role, [expectedRole]));
  const branchName = useMemo(() => {
    if (!currentUser) return '';
    const match = oddzialy.find((o) => String(o.id) === String(currentUser.oddzial_id));
    return match?.nazwa || currentUser.oddzial_nazwa || 'Wszystkie';
  }, [currentUser, oddzialy]);
  const quickActions = useMemo(() => {
    if (!currentUser) return [];
    if (canCreateQuickActions) {
      return [
        {
          id: 'phone-intake',
          label: 'Przyjmij telefon',
          hint: 'zgłoszenie -> oględziny',
          path: () => `/zlecenia?focus=telefon&t=${Date.now()}`,
          icon: 'plus',
        },
      ];
    }
    return [];
  }, [canCreateQuickActions, currentUser]);

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

  const W = collapsed ? 60 : 256;
  const rolaColor = getRolaColor(currentUser?.rola);
  const [logoutHover, setLogoutHover] = useState(false);

  const onActivateKeyDown = (handler) => (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handler();
    }
  };

  return (
    <>
      <div className="ios-glass-panel arbor-sidebar" style={{ ...sb.root, width: W }}>

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
              <div style={sb.logoSub}>Tree Care Operations</div>
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
                  {getRoleDisplayName(currentUser.rola)}
                </div>
                <div style={sb.branchPill}>
                  Oddział: {branchName}
                </div>
              </div>
            )}
          </div>
        )}

        {!collapsed ? (
          <div className="ios-section-title" style={{ margin: '6px 0 6px 10px' }}>{t('sidebar.menu')}</div>
        ) : (
          <div style={sb.separator} />
        )}

        {/* Nawigacja */}
        <nav style={sb.nav}>
          {!collapsed ? (
            <>
              {quickActions.length > 0 && (
                <div style={sb.quickPanel}>
                  <div style={sb.quickTitle}>Szybkie akcje</div>
                  <div style={sb.quickStack}>
                    {quickActions.map((action) => (
                      <button
                        key={action.id}
                        type="button"
                        onClick={() => {
                          const target = typeof action.path === 'function' ? action.path() : action.path;
                          navigate(target);
                        }}
                        style={sb.quickButton}
                      >
                        <span style={sb.quickIcon}>{ICONS[action.icon]}</span>
                        <span style={sb.quickText}>
                          <span style={sb.quickLabel}>{action.label}</span>
                          {action.hint ? <span style={sb.quickHint}>{action.hint}</span> : null}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {groupedLinks.map((group, gi) => (
                <div key={group.key} style={gi === 0 ? sb.navGroupFirst : sb.navGroup}>
                  <div style={sb.navGroupTitle}>
                    {t(`sidebar.groups.${group.key}`, { defaultValue: group.label })}
                  </div>
                  <div className="ios-inset" style={sb.navGroupInset}>
                    {group.primaryItems.map((link, i) => {
                      const active = isActivePath(location.pathname, link.path);
                      const isHov = hovered === link.path;
                      return (
                        <Fragment key={link.path}>
                          {i > 0 ? <div style={{ height: 1, background: 'var(--border)' }} aria-hidden /> : null}
                          <div
                            onClick={() => navigate(link.path)}
                            onKeyDown={onActivateKeyDown(() => navigate(link.path))}
                            onMouseEnter={() => setHovered(link.path)}
                            onMouseLeave={() => setHovered(null)}
                            role="button"
                            tabIndex={0}
                            aria-current={active ? 'page' : undefined}
                          className="ios-inset-row"
                          style={{
                            minHeight: 42,
                            padding: '8px 10px',
                            background: active ? 'linear-gradient(90deg, var(--nav-active-bg), rgba(255,255,255,0.01))' : isHov ? 'var(--ios-row-hover)' : 'var(--ios-inset-bg)',
                            color: active ? 'var(--text)' : 'var(--text-sub)',
                            fontWeight: active ? 600 : 500,
                              boxShadow: active ? 'inset 3px 0 0 var(--accent)' : 'none',
                            }}
                          >
                            <span
                              className="ios-icon-tile"
                              style={active ? { color: 'var(--accent)', border: '1px solid var(--border)' } : undefined}
                            >
                              {ICONS[link.icon]}
                            </span>
                            <span style={{ flex: 1, minWidth: 0, fontSize: 15 }}>{t(link.labelKey)}</span>
                            <NavChevron />
                          </div>
                        </Fragment>
                      );
                    })}
                    {group.secondaryItems.length > 0 ? (
                      <>
                        {group.primaryItems.length > 0 ? <div style={{ height: 1, background: 'var(--border)' }} aria-hidden /> : null}
                        <details
                          style={sb.subNavDetails}
                          open={group.secondaryItems.some((link) => isActivePath(location.pathname, link.path))}
                        >
                          <summary className="arbor-subnav-summary" style={sb.subNavSummary}>
                            <span style={sb.subNavSummaryDot} />
                            <span style={{ flex: 1 }}>
                              {t(`sidebar.groupMore.${group.key}`, { defaultValue: group.moreLabel || 'Podmoduły' })}
                            </span>
                            <span style={sb.subNavCount}>{group.secondaryItems.length}</span>
                          </summary>
                          <div style={sb.subNavList}>
                            {group.secondaryItems.map((link) => {
                              const active = isActivePath(location.pathname, link.path);
                              const isHov = hovered === link.path;
                              return (
                                <div
                                  key={link.path}
                                  onClick={() => navigate(link.path)}
                                  onKeyDown={onActivateKeyDown(() => navigate(link.path))}
                                  onMouseEnter={() => setHovered(link.path)}
                                  onMouseLeave={() => setHovered(null)}
                                  role="button"
                                  tabIndex={0}
                                  aria-current={active ? 'page' : undefined}
                                  style={{
                                    ...sb.subNavItem,
                                    background: active ? 'var(--nav-active-bg)' : isHov ? 'var(--ios-row-hover)' : 'transparent',
                                    color: active ? 'var(--text)' : 'var(--text-muted)',
                                    boxShadow: active ? 'inset 3px 0 0 var(--accent)' : 'none',
                                  }}
                                >
                                  <span style={{ ...sb.subNavIcon, color: active ? 'var(--accent)' : 'var(--text-muted)' }}>
                                    {ICONS[link.icon]}
                                  </span>
                                  <span style={sb.subNavLabel}>{t(link.labelKey)}</span>
                                </div>
                              );
                            })}
                          </div>
                        </details>
                      </>
                    ) : null}
                  </div>
                </div>
              ))}
            </>
          ) : (
            collapsedLinks.map((link) => {
              const active = isActivePath(location.pathname, link.path);
              const isHov = hovered === link.path;
              return (
                <div
                  key={link.path}
                  onClick={() => navigate(link.path)}
                  onKeyDown={onActivateKeyDown(() => navigate(link.path))}
                  onMouseEnter={() => setHovered(link.path)}
                  onMouseLeave={() => setHovered(null)}
                  role="button"
                  tabIndex={0}
                  aria-current={active ? 'page' : undefined}
                  title={t(link.labelKey)}
                  style={{
                    ...sb.navItem,
                    justifyContent: 'center',
                    padding: '10px 0',
                    background: active ? 'var(--nav-active-bg)' : isHov ? 'var(--nav-hover-bg)' : 'transparent',
                    color: active ? 'var(--accent)' : isHov ? 'var(--text)' : 'var(--text-sub)',
                    borderLeft: `3px solid ${active ? 'var(--accent)' : 'transparent'}`,
                    fontWeight: active ? 700 : 500,
                  }}
                >
                  <span style={{ flexShrink: 0, display: 'flex' }}>{ICONS[link.icon]}</span>
                </div>
              );
            })
          )}
        </nav>

        {/* Dolna sekcja */}
        <div style={sb.bottom}>
          {!collapsed ? (
            <div className="ios-inset" style={{ margin: '4px 8px 10px' }}>
              <div ref={notifRef} style={{ position: 'relative' }}>
                <div
                  onClick={() => setShowNotif(!showNotif)}
                  onKeyDown={onActivateKeyDown(() => setShowNotif(!showNotif))}
                  role="button"
                  tabIndex={0}
                  aria-label={t('sidebar.notificationsAria')}
                  aria-expanded={showNotif}
                  className="ios-inset-row"
                  style={{
                    cursor: 'pointer',
                    background: showNotif ? 'linear-gradient(90deg, var(--nav-active-bg), rgba(255,255,255,0.01))' : 'var(--ios-inset-bg)',
                    color: showNotif ? 'var(--text)' : 'var(--text-sub)',
                    fontWeight: 500,
                    boxShadow: showNotif ? 'inset 3px 0 0 var(--accent)' : 'none',
                  }}
                >
                  <span
                    className="ios-icon-tile"
                    style={{ position: 'relative', ...(showNotif ? { color: 'var(--accent)', border: '1px solid var(--border)' } : {}) }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {ICONS.bell}
                      {notifCount > 0 && (
                        <span style={sb.badge}>{notifCount > 99 ? '99+' : notifCount}</span>
                      )}
                    </span>
                  </span>
                  <span style={{ flex: 1, fontSize: 15 }}>{t('sidebar.notifications')}</span>
                  {notifCount > 0 ? (
                    <span style={{ ...sb.badge, position: 'static', borderRadius: 8, padding: '1px 8px', marginRight: 4 }}>
                      {notifCount > 99 ? '99+' : notifCount}
                    </span>
                  ) : null}
                  <NavChevron />
                </div>

                {showNotif && (
                  <div style={{ ...sb.notifPanel, left: 236 }}>
                    <div style={sb.notifHeader}>
                      <span style={sb.notifTitle}>{t('sidebar.notifications')}</span>
                      {notifCount > 0 && (
                        <button type="button" onClick={markAll} style={sb.markAllBtn}>{t('sidebar.markAllRead')}</button>
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
                          onClick={() => openNotification(n)}
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
                        <button type="button" onClick={() => { navigate('/powiadomienia'); setShowNotif(false); }} style={sb.markAllBtn}>
                          {t('sidebar.seeAll')}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div style={{ height: 1, background: 'rgba(255,255,255,0.08)' }} aria-hidden />
              <div
                onClick={handleLogout}
                onKeyDown={onActivateKeyDown(handleLogout)}
                onMouseEnter={() => setLogoutHover(true)}
                onMouseLeave={() => setLogoutHover(false)}
                role="button"
                tabIndex={0}
                aria-label={t('sidebar.logoutAria')}
                className="ios-inset-row"
                style={{
                  cursor: 'pointer',
                  background: logoutHover ? 'rgba(248, 113, 113, 0.08)' : 'var(--ios-inset-bg)',
                  color: logoutHover ? 'var(--danger)' : 'var(--text-muted)',
                  fontWeight: 500,
                  minHeight: 42,
                  padding: '7px 12px',
                }}
              >
                <span className="ios-icon-tile" style={logoutHover ? { color: 'var(--danger)', border: '1px solid rgba(248,113,113,0.35)' } : undefined}>
                  {ICONS.logout}
                </span>
                <span style={{ flex: 1, fontSize: 15 }}>{t('sidebar.logout')}</span>
                <NavChevron />
              </div>
            </div>
          ) : (
            <>
              <div style={sb.separator} />
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
                    justifyContent: 'center',
                    padding: '10px 0',
                    background: showNotif ? 'var(--nav-active-bg)' : 'transparent',
                    color: showNotif ? 'var(--accent)' : 'var(--text-sub)',
                    borderLeft: `3px solid ${showNotif ? 'var(--accent)' : 'transparent'}`,
                    cursor: 'pointer',
                  }}
                >
                  <span style={{ flexShrink: 0, display: 'flex', position: 'relative' }}>
                    {ICONS.bell}
                    {notifCount > 0 && (
                      <span style={sb.badge}>{notifCount > 99 ? '99+' : notifCount}</span>
                    )}
                  </span>
                </div>
                {showNotif && (
                  <div style={{ ...sb.notifPanel, left: 72 }}>
                    <div style={sb.notifHeader}>
                      <span style={sb.notifTitle}>{t('sidebar.notifications')}</span>
                      {notifCount > 0 && (
                        <button type="button" onClick={markAll} style={sb.markAllBtn}>{t('sidebar.markAllRead')}</button>
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
                          onClick={() => openNotification(n)}
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
                        <button type="button" onClick={() => { navigate('/powiadomienia'); setShowNotif(false); }} style={sb.markAllBtn}>
                          {t('sidebar.seeAll')}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div
                onClick={handleLogout}
                onKeyDown={onActivateKeyDown(handleLogout)}
                onMouseEnter={() => setLogoutHover(true)}
                onMouseLeave={() => setLogoutHover(false)}
                role="button"
                tabIndex={0}
                aria-label={t('sidebar.logoutAria')}
                style={{
                  ...sb.navItem,
                  justifyContent: 'center',
                  padding: '10px 0',
                  color: logoutHover ? 'var(--danger)' : 'var(--text-muted)',
                  background: logoutHover ? 'rgba(248,113,113,0.1)' : 'transparent',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                  borderLeft: '3px solid transparent',
                }}
              >
                <span style={{ display: 'flex', flexShrink: 0 }}>{ICONS.logout}</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Spacer */}
      <div style={{ width: W, flexShrink: 0, minHeight: '100vh', transition: 'width 0.25s ease' }} aria-hidden />
    </>
  );
}

// ─── Style ────────────────────────────────────────────────────────────────────
/* Arbor navigation shell. */
const NAV_BG = '#06331f';
const NAV_MUTED= 'rgba(244,255,248,0.62)';
const NAV_BORDER = 'rgba(255,255,255,0.14)';

const sb = {
  root: {
    height: '100vh', position: 'fixed', left: 0, top: 0, zIndex: 200,
    background: 'linear-gradient(180deg, #06331f, #0c4d31 68%, #093a25)',
    backgroundColor: NAV_BG,
    display: 'flex', flexDirection: 'column',
    borderRight: 'none',
    transition: 'width 0.25s ease',
    overflow: 'hidden',
    boxShadow: '16px 0 46px rgba(11,61,39,0.22)',
  },
  collapseBtn: {
    position: 'absolute', right: -13, top: 28, width: 26, height: 26,
    borderRadius: '50%', background: '#0c4d31',
    border: `1px solid ${NAV_BORDER}`,
    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: '#f4fff8', zIndex: 201, boxShadow: '0 10px 24px rgba(0,0,0,0.24)',
    transition: 'all 0.15s',
  },
  logo: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '16px 14px 14px', borderBottom: `1px solid ${NAV_BORDER}`,
  },
  logoIcon: {
    width: 34, height: 34, borderRadius: 8, background: 'linear-gradient(145deg, #eaffef, #8ce6ac)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0, color: '#0f5f3a',
  },
  logoName: { fontFamily: 'Inter, sans-serif', fontSize: 15, fontWeight: 700, color: '#ffffff', letterSpacing: 0 },
  logoSub: { fontSize: 10, color: NAV_MUTED, letterSpacing: 0, marginTop: 2, fontWeight: 500 },
  userCard: {
    display: 'flex', alignItems: 'center', gap: 10, margin: '10px 10px 6px',
    background: 'rgba(255,255,255,0.075)', borderRadius: 8,
    border: `1px solid ${NAV_BORDER}`,
    padding: '10px 12px',
  },
  avatar: {
    width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center',
    justifyContent: 'center', flexShrink: 0,
  },
  avatarText: { fontSize: 12, fontWeight: 700 },
  userName: { fontSize: 13, fontWeight: 600, color: '#ffffff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  rolaBadge: { fontSize: 10, fontWeight: 600, borderRadius: 4, padding: '2px 7px', display: 'inline-block', marginTop: 3 },
  branchPill: {
    marginTop: 3,
    display: 'flex', alignItems: 'center',
    color: NAV_MUTED, fontSize: 11, fontWeight: 500,
  },
  quickPanel: {
    margin: '4px 8px 10px',
    padding: '10px',
    borderRadius: 8,
    border: `1px solid ${NAV_BORDER}`,
    background: 'rgba(255,255,255,0.075)',
  },
  quickTitle: {
    margin: '0 0 8px',
    color: NAV_MUTED,
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
  },
  quickStack: { display: 'grid', gap: 5 },
  quickButton: {
    minHeight: 38,
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: 9,
    border: `1px solid ${NAV_BORDER}`,
    borderRadius: 8,
    background: 'rgba(255,255,255,0.1)',
    color: '#ffffff',
    padding: '6px 9px',
    fontSize: 13,
    fontWeight: 500,
    textAlign: 'left',
    cursor: 'pointer',
  },
  quickText: { minWidth: 0, display: 'grid', gap: 1 },
  quickLabel: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  quickHint: {
    color: NAV_MUTED, fontSize: 11, fontWeight: 400,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  quickIcon: {
    width: 22, height: 22, borderRadius: 6,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    color: '#8ce6ac', background: 'rgba(255,255,255,0.12)',
    flexShrink: 0,
  },
  sectionLabel: {
    fontSize: 10, color: NAV_MUTED, fontWeight: 700,
    letterSpacing: '0.09em', padding: '10px 14px 4px', textTransform: 'uppercase',
  },
  separator: { height: 1, background: NAV_BORDER, margin: '4px 10px' },
  nav: { flex: 1, minHeight: 0, padding: '2px 8px 4px', overflowY: 'auto' },
  navGroupFirst: { margin: '0 0 6px' },
  navGroup: { margin: '8px 0 6px' },
  navGroupTitle: {
    margin: '0 10px 5px',
    fontSize: 10, fontWeight: 700, fontFamily: 'Inter, sans-serif',
    color: NAV_MUTED, letterSpacing: '0.09em', textTransform: 'uppercase',
  },
  navGroupInset: { margin: 0, border: `1px solid ${NAV_BORDER}`, background: 'rgba(255,255,255,0.07)', borderRadius: 8 },
  navItem: {
    display: 'flex', alignItems: 'center', borderRadius: 6, cursor: 'pointer',
    fontSize: 13, fontWeight: 500, transition: 'background 0.12s ease, color 0.12s ease',
    marginBottom: 3, userSelect: 'none',
  },
  subNavDetails: { margin: 0, padding: 0 },
  subNavSummary: {
    minHeight: 36, padding: '6px 10px',
    display: 'flex', alignItems: 'center', gap: 8,
    cursor: 'pointer', color: NAV_MUTED,
    fontSize: 12, fontWeight: 600,
    listStyle: 'none', userSelect: 'none',
    background: 'transparent',
  },
  subNavSummaryDot: {
    width: 6, height: 6, borderRadius: '50%',
    background: '#8ce6ac', opacity: 0.8, flexShrink: 0,
  },
  subNavCount: {
    minWidth: 20, height: 20, borderRadius: 6,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    background: 'rgba(255,255,255,0.08)',
    color: NAV_MUTED, fontSize: 11, fontWeight: 700,
    fontVariantNumeric: 'tabular-nums',
  },
  subNavList: {
    display: 'grid', gap: 2, padding: '4px 6px 6px',
    background: 'rgba(0,0,0,0.12)', borderTop: `1px solid ${NAV_BORDER}`,
  },
  subNavItem: {
    minHeight: 32, display: 'flex', alignItems: 'center', gap: 8,
    borderRadius: 5, padding: '5px 8px', cursor: 'pointer',
    transition: 'background 0.12s ease, color 0.12s ease',
  },
  subNavIcon: {
    width: 20, height: 20, borderRadius: 5,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0, transform: 'scale(0.86)',
  },
  subNavLabel: {
    flex: 1, minWidth: 0, fontSize: 12, fontWeight: 500,
    lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  activeDot: { marginLeft: 'auto', width: 6, height: 6, borderRadius: '50%', background: '#8ce6ac' },
  bottom: { padding: '4px 8px 10px', flexShrink: 0 },
  badge: {
    position: 'absolute', top: -4, right: -4, background: '#EF4444', color: '#fff',
    borderRadius: '50%', minWidth: 16, height: 16, fontSize: 10, fontWeight: 700,
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 2px',
  },
  notifPanel: {
    position: 'fixed', bottom: 80, width: 340, background: '#ffffff',
    border: '1px solid rgba(15,95,58,0.12)', borderRadius: 10,
    boxShadow: '0 18px 44px rgba(15,95,58,0.14)',
    zIndex: 1000, maxHeight: 460, overflowY: 'auto',
  },
  notifHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '14px 16px', borderBottom: '1px solid rgba(15,95,58,0.12)',
    position: 'sticky', top: 0, background: '#ffffff', zIndex: 1,
  },
  notifTitle: { fontSize: 14, fontWeight: 700, color: '#323338' },
  markAllBtn: { fontSize: 12, color: '#0f6b3f', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 },
  notifEmpty: { padding: '32px 24px', textAlign: 'center' },
  notifItem: {
    display: 'flex', gap: 10, padding: '12px 14px', borderBottom: '1px solid rgba(15,95,58,0.12)',
    cursor: 'pointer', transition: 'background 0.15s',
  },
  notifDot: { width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  notifTop: { display: 'flex', justifyContent: 'space-between', marginBottom: 2 },
  notifTyp: { fontSize: 11, fontWeight: 700, textTransform: 'uppercase' },
  notifTime: { fontSize: 10, color: '#676879' },
  notifOd: { fontSize: 12, color: '#676879', marginBottom: 2 },
  notifTresc: { fontSize: 12, color: '#676879', lineHeight: 1.45 },
};
