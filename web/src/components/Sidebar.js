import { useNavigate, useLocation } from 'react-router-dom';
import { useEffect, useState, useRef, useMemo, Fragment } from 'react';
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
  pytanie: '#60A5FA', info: '#94A3B8', nowe_zlecenie: 'var(--accent)',
  potwierdzenie_godzin: 'var(--accent)', raport_dnia_ekipy: 'var(--accent)', kasa_oddzial_nieodebrana: '#F87171',
  delegacja: '#FBBF24', przypomnienie: '#F87171',
};
// SVG ikony nawigacji
const ICONS = {
  dashboard:    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>,
  mission:      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/><path d="M6 19h4"/></svg>,
  autoplan:     <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 15c4-8 12-8 16 0"/><path d="M8 15c2-4 6-4 8 0"/><circle cx="12" cy="16" r="2"/><path d="M12 4v3"/><path d="M4.9 6.9l2.1 2.1"/><path d="M19.1 6.9 17 9"/></svg>,
  zlecenia:     <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="13" y2="16"/></svg>,
  harmonogram:  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
  kierownik:    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>,
  ekipy:        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  flota:        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="1" y="3" width="15" height="13" rx="2"/><path d="M16 8h4l3 5v3h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>,
  warehouse:    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>,
  equipmentRes: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><circle cx="8" cy="15" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="15" r="1" fill="currentColor" stroke="none"/><circle cx="16" cy="15" r="1" fill="currentColor" stroke="none"/></svg>,
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
  plus:         <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
};

function NavChevron() {
  return null;
}

const NAV_GROUPS = [
  { key: 'start', label: 'Start' },
  { key: 'operations', label: 'Operacje' },
  { key: 'sales', label: 'Sprzedaz' },
  { key: 'hr', label: 'Kadry' },
  { key: 'finance', label: 'Finanse' },
  { key: 'assets', label: 'Zasoby' },
  { key: 'settings', label: 'Ustawienia' },
];

const NAV_GROUP_BY_PATH = {
  '/dashboard': 'start',
  '/profil': 'settings',
  '/zadania': 'settings',
  '/raporty': 'settings',
  '/zlecenia': 'operations',
  '/harmonogram': 'operations',
  '/kierownik': 'operations',
  '/ekipy': 'operations',
  '/wyceniajacy-hub': 'sales',
  '/crm': 'sales',
  '/wycena-kalendarz': 'sales',
  '/blokady-kalendarza': 'sales',
  '/zatwierdz-wyceny': 'sales',
  '/wyceny-terenowe': 'sales',
  '/klienci': 'sales',
  '/telefonia': 'sales',
  '/integracje': 'sales',
  '/kadry-dokumenty': 'hr',
  '/rozliczenia-ekip': 'finance',
  '/wynagrodzenie-wyceniajacych': 'finance',
  '/ksiegowosc': 'finance',
  '/flota': 'assets',
  '/magazyn': 'assets',
  '/rezerwacje-sprzetu': 'assets',
  '/potwierdzenia-ekip': 'operations',
  '/uzytkownicy': 'settings',
  '/oddzialy': 'settings',
  '/zarzadzaj-rolami': 'settings',
};

function groupLinks(links) {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: links.filter((link) => (NAV_GROUP_BY_PATH[link.path] || 'start') === group.key),
  })).filter((group) => group.items.length > 0);
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
  const { themeId, setTheme } = useTheme();

  useEffect(() => {
    const u = readStoredUser();
    if (u) setCurrentUser(u);
    loadNotifications();
    loadBranches();
    const iv = setInterval(loadNotifications, 30000);
    const onOutside = (e) => { if (notifRef.current && !notifRef.current.contains(e.target)) setShowNotif(false); };
    const onKey = (e) => { if (e.key === 'Escape') setShowNotif(false); };
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('keydown', onKey);
    return () => { clearInterval(iv); document.removeEventListener('mousedown', onOutside); document.removeEventListener('keydown', onKey); };
  }, []);

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth < 760) setCollapsed(true);
    };
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const links = useMemo(() => {
    const ADMIN   = ['Dyrektor', 'Administrator'];
    const MGMT    = ['Dyrektor', 'Administrator', 'Kierownik'];
    const WORKERS = ['Dyrektor', 'Administrator', 'Kierownik', 'Brygadzista', 'Specjalista', 'Pomocnik', 'Pomocnik bez doświadczenia'];
    const FIELD_OPS = ['Dyrektor', 'Administrator', 'Kierownik', 'Brygadzista', 'Specjalista', 'Pomocnik', 'Pomocnik bez doświadczenia'];
    const ALL     = ['Dyrektor', 'Administrator', 'Kierownik', 'Brygadzista', 'Specjalista', 'Pomocnik', 'Pomocnik bez doświadczenia', 'Wyceniający', 'Magazynier'];
    const all = [
      { path: '/dashboard',         labelKey: 'nav.dashboard',       icon: 'dashboard',   roles: ALL },
      { path: '/profil',           labelKey: 'nav.profile',          icon: 'profil',      roles: ALL },
      { path: '/zadania',          labelKey: 'nav.todos',            icon: 'zlecenia',    roles: ALL },
      { path: '/kadry-dokumenty',  labelKey: 'nav.hrDocuments',      icon: 'uzytkownicy', roles: MGMT },
      { path: '/wyceniajacy-hub', labelKey: 'nav.estimatorHub',     icon: 'wyceny',       roles: ['Dyrektor', 'Administrator', 'Kierownik', 'Wyceniający', 'Specjalista'] },
      { path: '/crm',               labelKey: 'nav.crm',           icon: 'crm',         roles: [...MGMT, 'Wyceniający', 'Specjalista'] },
      { path: '/zlecenia',          labelKey: 'nav.orders',          icon: 'zlecenia',    roles: [...WORKERS, 'Magazynier'] },
      { path: '/harmonogram',       labelKey: 'nav.schedule',      icon: 'harmonogram', roles: [...MGMT, 'Brygadzista', 'Specjalista', 'Magazynier'] },
      { path: '/wycena-kalendarz',  labelKey: 'nav.quotes',          icon: 'wyceny',      roles: ['Wyceniający', 'Specjalista', ...MGMT] },
      { path: '/blokady-kalendarza', labelKey: 'nav.calendarBlocks', icon: 'calendarBlocks', roles: ['Wyceniający', 'Specjalista', ...MGMT] },
      { path: '/zatwierdz-wyceny',  labelKey: 'nav.approveQuotes',   icon: 'approveNav',   roles: ['Kierownik', 'Administrator', 'Dyrektor', 'Specjalista'] },
      { path: '/wyceny-terenowe',   labelKey: 'nav.fieldQuotes',     icon: 'wyceny',      roles: ['Wyceniający', 'Kierownik', 'Dyrektor', 'Administrator', 'Specjalista'] },
      { path: '/klienci',           labelKey: 'nav.clients',       icon: 'klienci',     roles: MGMT },
      { path: '/telefonia',         labelKey: 'nav.telephony',     icon: 'telefonia',   roles: MGMT },
      { path: '/zlecenia',          labelKey: 'nav.orders',          icon: 'zlecenia',    roles: [...WORKERS, ...SALES_DIRECTOR, 'Magazynier'] },
      { path: '/harmonogram',       labelKey: 'nav.schedule',      icon: 'harmonogram', roles: [...MGMT, ...SALES_DIRECTOR, 'Brygadzista', 'Specjalista', 'Magazynier'] },
      { path: '/wycena-kalendarz',  labelKey: 'nav.quotes',          icon: 'wyceny',      roles: ['Wyceniający', 'Specjalista', ...MGMT] },
      { path: '/blokady-kalendarza', labelKey: 'nav.calendarBlocks', icon: 'harmonogram', roles: ['Wyceniający', 'Specjalista', ...MGMT] },
      { path: '/wyceny-terenowe',   labelKey: 'nav.fieldQuotes',     icon: 'wyceny',      roles: ['Wyceniający', 'Kierownik', 'Prezes', 'Dyrektor', 'Specjalista'] },
      { path: '/klienci',           labelKey: 'nav.clients',       icon: 'klienci',     roles: MGMT },
      { path: '/integracje',        labelKey: 'nav.integrations',  icon: 'integracje',  roles: MGMT },
      { path: '/wynagrodzenie-wyceniajacych', labelKey: 'nav.estimatorPayout', icon: 'ksiegowosc', roles: ['Prezes', 'Dyrektor', 'Kierownik', 'Wyceniający'] },
      { path: '/rozliczenia-ekip',  labelKey: 'nav.payrollTeams',  icon: 'ksiegowosc',  roles: ['Prezes', 'Dyrektor', 'Kierownik'] },
      { path: '/kierownik',         labelKey: 'nav.planning',      icon: 'kierownik',   roles: MGMT },
      { path: '/ekipy',             labelKey: 'nav.teams',         icon: 'ekipy',       roles: MGMT },
      { path: '/potwierdzenia-ekip', labelKey: 'nav.crewAttendance', icon: 'crewAttendance', roles: ALL },
      { path: '/ranking-brygad',    labelKey: 'nav.teamRanking',   icon: 'raporty',     roles: [...MGMT, ...SALES_DIRECTOR] },
      { path: '/flota',             labelKey: 'nav.fleet',         icon: 'flota',       roles: [...MGMT, 'Brygadzista', 'Magazynier'] },
      { path: '/magazyn',           labelKey: 'nav.warehouse',   icon: 'warehouse',   roles: [...MGMT, 'Brygadzista', 'Magazynier'] },
      { path: '/rezerwacje-sprzetu', labelKey: 'nav.equipmentReservations', icon: 'equipmentRes', roles: [...MGMT, 'Brygadzista', 'Magazynier'] },
      { path: '/ksiegowosc',        labelKey: 'nav.accounting',    icon: 'ksiegowosc',  roles: MGMT },
      { path: '/raporty',           labelKey: 'nav.reports',       icon: 'raporty',     roles: FIELD_OPS },
      { path: '/uzytkownicy',       labelKey: 'nav.users',         icon: 'uzytkownicy', roles: ADMIN },
      { path: '/oddzialy',          labelKey: 'nav.branches',      icon: 'oddzialy',    roles: ADMIN },
      { path: '/zarzadzaj-rolami',  labelKey: 'nav.roles',         icon: 'uzytkownicy', roles: ADMIN },
    ];
    return currentUser ? all.filter(l => l.roles.includes(currentUser.rola)) : all;
  }, [currentUser]);

  const groupedLinks = useMemo(() => groupLinks(links), [links]);
  const quickActions = useMemo(() => {
    const role = currentUser?.rola;
    const isOffice = ['Dyrektor', 'Administrator', 'Kierownik', 'Specjalista'].includes(role);
    const isEstimator = ['Dyrektor', 'Administrator', 'Kierownik', 'Specjalista', 'Wyceniający'].includes(role);
    return [
      isOffice ? { label: 'Nowe zlecenie', path: '/nowe-zlecenie', icon: 'plus' } : null,
      isEstimator ? { label: 'Wycena terenowa', path: '/wyceniajacy-hub', icon: 'wyceny' } : null,
      isOffice ? { label: 'Dodaj klienta', path: '/klienci', icon: 'klienci' } : null,
    ].filter(Boolean);
  }, [currentUser?.rola]);

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
  const handleLogout = () => { localStorage.clear(); navigate('/'); };
  const role = currentUser?.rola;
  const canCreateQuickActions = [
    'Prezes',
    'Dyrektor',
    'Kierownik',
    'Dyrektor Sprzedazy',
    'Dyrektor Sprzedaży',
    'Dyrektor SprzedaĹĽy',
    'Dyrektor dzialu sprzedaz',
    'Dyrektor dziaĹ‚u sprzedaĹĽ',
  ].includes(role);
  const branchName = useMemo(() => {
    if (!currentUser) return '';
    const match = oddzialy.find((o) => String(o.id) === String(currentUser.oddzial_id));
    return match?.nazwa || currentUser.oddzial_nazwa || 'Wszystkie';
  }, [currentUser, oddzialy]);
  const quickActions = useMemo(() => {
    if (!currentUser) return [];
    if (canCreateQuickActions) {
      return [
        { label: 'Nowe zlecenie', path: '/nowe-zlecenie', icon: 'plus' },
        { label: 'Nowa praca', path: '/nowe-zlecenie?typ=praca', icon: 'zlecenia' },
        { label: 'Dodaj klienta', path: '/klienci', icon: 'klienci' },
      ];
    }
    return [
      { label: 'Moje zlecenia', path: '/zlecenia', icon: 'zlecenia' },
      { label: 'Harmonogram', path: '/harmonogram', icon: 'harmonogram' },
      { label: 'Raport', path: '/raporty', icon: 'raporty' },
    ].filter((item) => links.some((link) => link.path === item.path));
  }, [canCreateQuickActions, currentUser, links]);

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

  const W = collapsed ? 60 : 224;
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
                  {currentUser.rola}
                </div>
                <div style={sb.branchPill}>
                  Oddział: {currentUser.oddzial_nazwa || currentUser.oddzial || 'Centrala'}
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
              {groupedLinks.map((group, gi) => (
                <div key={group.key} style={gi === 0 ? sb.navGroupFirst : sb.navGroup}>
                  <div style={sb.navGroupTitle}>
                    {t(`sidebar.groups.${group.key}`, { defaultValue: group.label })}
                  </div>
                  <div className="ios-inset" style={sb.navGroupInset}>
                    {group.items.map((link, i) => {
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
                              style={active ? { color: 'var(--accent)', border: '1px solid var(--border2)' } : undefined}
                            >
                              {ICONS[link.icon]}
                            </span>
                            <span style={{ flex: 1, minWidth: 0, fontSize: 15 }}>{t(link.labelKey)}</span>
                            <NavChevron />
                          </div>
                        </Fragment>
                      );
                    })}
                  </div>
                </div>
              ))}
              {quickActions.length > 0 && (
                <div style={sb.quickPanel}>
                  <div style={sb.quickTitle}>Szybkie akcje</div>
                  <div style={sb.quickStack}>
                    {quickActions.map((action) => (
                      <button
                        key={action.path}
                        type="button"
                        onClick={() => navigate(action.path)}
                        style={sb.quickButton}
                      >
                        <span style={sb.quickIcon}>{ICONS[action.icon]}</span>
                        <span>{action.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            links.map((link) => {
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

          {!collapsed && quickActions.length > 0 && (
            <div style={sb.quickBox}>
              <div style={sb.quickTitle}>Szybkie akcje</div>
              <div style={sb.quickList}>
                {quickActions.map((action) => (
                  <button
                    key={action.label}
                    type="button"
                    onClick={() => navigate(action.path)}
                    style={sb.quickBtn}
                  >
                    <span style={sb.quickIcon}>{ICONS[action.icon] || ICONS.plus}</span>
                    <span>{action.label}</span>
                  </button>
                ))}
              </div>
            </div>
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
                    style={{ position: 'relative', ...(showNotif ? { color: 'var(--accent)', border: '1px solid var(--border2)' } : {}) }}
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
                        <button type="button" onClick={() => { navigate('/powiadomienia'); setShowNotif(false); }} style={sb.markAllBtn}>
                          {t('sidebar.seeAll')}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div style={{ height: 1, background: 'var(--border)' }} aria-hidden />
              <div style={{ padding: '6px 12px', background: 'var(--ios-inset-bg)' }}>
                <LanguageSwitcher
                  compact
                  style={{ justifyContent: 'flex-start', width: '100%' }}
                />
              </div>
              <div style={{ height: 1, background: 'var(--border)' }} aria-hidden />
              <div style={{
                padding: '7px 12px',
                background: 'var(--ios-inset-bg)',
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: 8,
              }}
              >
                <span className="ios-section-title" style={{ margin: '0 0 2px 0', width: '100%' }}>{t('sidebar.theme')}</span>
                {Object.values(THEMES).map((th) => (
                  <button
                    key={th.id}
                    title={th.label}
                    type="button"
                    onClick={() => setTheme(th.id)}
                    style={{
                      width: 18, height: 18, borderRadius: '50%',
                      background: th.previewDot,
                      border: themeId === th.id ? '2px solid var(--accent)' : '2px solid transparent',
                      cursor: 'pointer',
                      boxShadow: themeId === th.id ? `0 0 6px ${th.previewDot}55` : 'none',
                      outline: 'none',
                      transition: 'border-color 0.2s, box-shadow 0.2s',
                      flexShrink: 0,
                      padding: 0,
                    }}
                  />
                ))}
              </div>
              <div style={{ height: 1, background: 'var(--border)' }} aria-hidden />
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
                        <button type="button" onClick={() => { navigate('/powiadomienia'); setShowNotif(false); }} style={sb.markAllBtn}>
                          {t('sidebar.seeAll')}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div style={{ padding: '8px 4px', borderTop: '1px solid var(--border)' }}>
                <LanguageSwitcher compact style={{ justifyContent: 'center', width: '100%' }} />
              </div>
              <div style={{ padding: '8px 4px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                {Object.values(THEMES).map((th) => (
                  <button
                    key={th.id}
                    title={th.label}
                    type="button"
                    onClick={() => setTheme(th.id)}
                    style={{
                      width: 18, height: 18, borderRadius: '50%',
                      background: th.previewDot,
                      border: themeId === th.id ? '2px solid var(--accent)' : '2px solid transparent',
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
const sb = {
  root: {
    height: '100vh', position: 'fixed', left: 0, top: 0, zIndex: 200,
    background: 'linear-gradient(180deg, var(--sidebar) 0%, var(--bg-card2) 56%, var(--bg-deep) 100%)', display: 'flex', flexDirection: 'column',
    backgroundImage: 'linear-gradient(180deg, var(--sidebar) 0%, var(--bg-card2) 56%, var(--bg-deep) 100%), repeating-linear-gradient(135deg, var(--leaf-line) 0 1px, transparent 1px 22px)',
    borderRight: '1px solid var(--border2)', transition: 'width 0.25s ease',
    overflow: 'hidden', boxShadow: 'var(--shadow-md)',
  },
  collapseBtn: {
    position: 'absolute', right: -12, top: 28, width: 24, height: 24,
    borderRadius: '50%', background: 'linear-gradient(135deg, var(--bg-card2), var(--bg-card))',
    border: '1px solid var(--border2)',
    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: 'var(--accent)', zIndex: 201, boxShadow: 'var(--shadow-sm)',
    transition: 'all 0.15s',
  },
  logo: {
    display: 'flex', alignItems: 'center', gap: 12,
    padding: '20px 16px 18px', borderBottom: '1px solid var(--border)',
  },
  logoIcon: {
    width: 50, height: 50, borderRadius: '50%', background: 'linear-gradient(135deg, var(--logo-tint-bg), rgba(20,131,79,0.04))',
    border: '1px solid var(--logo-tint-border)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
    boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.38), 0 10px 22px rgba(20,91,54,0.1)',
  },
  logoName: { fontSize: 18, fontWeight: 900, color: 'var(--text)', letterSpacing: 0 },
  logoSub: { fontSize: 10, color: 'var(--text-sub)', letterSpacing: 0, marginTop: 2, fontWeight: 700 },
  userCard: {
    display: 'flex', alignItems: 'center', gap: 10, margin: '12px 12px 6px',
    background: 'linear-gradient(180deg, var(--glass-bg-strong), var(--glass-bg))', borderRadius: 8,
    border: '1px solid var(--glass-border)',
    boxShadow: 'var(--shadow-sm)',
  },
  avatar: {
    width: 38, height: 38, borderRadius: '50%', display: 'flex', alignItems: 'center',
    justifyContent: 'center', flexShrink: 0,
    boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.05)',
  },
  avatarText: { fontSize: 13, fontWeight: 800 },
  userName: { fontSize: 13, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  rolaBadge: { fontSize: 10, fontWeight: 700, borderRadius: 6, padding: '2px 8px', display: 'inline-block', marginTop: 3 },
  branchPill: {
    marginTop: 7,
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: 26,
    padding: '4px 9px',
    borderRadius: 7,
    border: '1px solid var(--border)',
    background: 'var(--surface-field)',
    color: 'var(--text-sub)',
    fontSize: 11,
    fontWeight: 800,
  },
  quickPanel: {
    margin: '14px 4px 8px',
    padding: '10px',
    borderRadius: 8,
    border: '1px solid var(--glass-border)',
    background: 'linear-gradient(180deg, var(--glass-bg-strong), var(--glass-bg))',
    boxShadow: 'var(--shadow-sm)',
  },
  quickTitle: {
    margin: '0 0 8px',
    color: 'var(--text-muted)',
    fontSize: 10,
    fontWeight: 900,
    textTransform: 'uppercase',
  },
  quickStack: { display: 'grid', gap: 7 },
  quickButton: {
    minHeight: 34,
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: 9,
    border: '1px solid var(--border)',
    borderRadius: 7,
    background: 'var(--accent-surface)',
    color: 'var(--text)',
    padding: '7px 9px',
    fontSize: 13,
    fontWeight: 850,
    textAlign: 'left',
    cursor: 'pointer',
  },
  quickIcon: {
    width: 23,
    height: 23,
    borderRadius: 6,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--accent)',
    background: 'var(--bg-card)',
    border: '1px solid var(--border2)',
    flexShrink: 0,
  },
  sectionLabel: { fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, letterSpacing: 1.5, padding: '12px 16px 4px' },
  separator: { height: 1, background: 'var(--border)', margin: '4px 12px' },
  nav: { flex: 1, minHeight: 0, padding: '2px 8px 4px', overflowY: 'auto' },
  navGroupFirst: { margin: '0 0 8px' },
  navGroup: { margin: '10px 0 8px' },
  navGroupTitle: {
    margin: '0 10px 5px',
    fontSize: 10,
    fontWeight: 800,
    color: 'var(--text-muted)',
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
  navGroupInset: { margin: 0, border: '1px solid var(--glass-border)', background: 'linear-gradient(180deg, var(--glass-bg-strong), var(--glass-bg))' },
  navItem: {
    display: 'flex', alignItems: 'center', borderRadius: 6, cursor: 'pointer',
    fontSize: 13, fontWeight: 500, transition: 'background 0.15s ease, color 0.15s ease, border-color 0.15s ease',
    marginBottom: 3, userSelect: 'none',
  },
  activeDot: { marginLeft: 'auto', width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)' },
  bottom: { padding: '4px 8px 10px', flexShrink: 0 },
  badge: {
    position: 'absolute', top: -4, right: -4, background: '#EF4444', color: '#fff',
    borderRadius: '50%', minWidth: 16, height: 16, fontSize: 10, fontWeight: 700,
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 2px',
  },
  notifPanel: {
    position: 'fixed', bottom: 80, width: 340, background: 'linear-gradient(180deg, var(--bg-card), var(--bg-card2))',
    border: '1px solid var(--border2)', borderRadius: 8,
    boxShadow: 'var(--shadow-lg)',
    zIndex: 1000, maxHeight: 460, overflowY: 'auto',
  },
  notifHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '14px 16px', borderBottom: '1px solid var(--border)',
    position: 'sticky', top: 0, background: 'var(--bg-card2)', zIndex: 1,
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
