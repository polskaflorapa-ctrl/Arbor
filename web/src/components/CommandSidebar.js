import { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { readStoredUser } from '../utils/readStoredUser';
import { getRoleDisplayName } from '../utils/roleDisplay';

export default function CommandSidebar({ active = 'dashboard', user = null, onPlanDay = null }) {
  const navigate = useNavigate();
  const location = useLocation();
  const currentUser = useMemo(() => user || readStoredUser() || {}, [user]);
  const navGroups = [
    {
      label: 'Start',
      items: [
        { key: 'dashboard', label: 'Pulpit', path: '/dashboard' },
        { key: 'profile', label: 'Profil', path: '/profil' },
        { key: 'tasks', label: 'Moje zadania', path: '/zadania' },
        { key: 'notifications', label: 'Powiadomienia', path: '/powiadomienia' },
      ],
    },
    {
      label: 'Operacje',
      items: [
        { key: 'orders', label: 'Zlecenia', path: '/zlecenia' },
        { key: 'schedule', label: 'Harmonogram', path: '/harmonogram' },
        { key: 'manager', label: 'Kierownik', path: '/kierownik', activeKey: 'dashboard' },
        { key: 'map', label: 'Mapa live', path: '/mapa-live', activeKey: 'schedule' },
        { key: 'dispatch', label: 'Auto dispatch', path: '/auto-dispatch', activeKey: 'schedule' },
      ],
    },
    {
      label: 'Sprzedaz i wyceny',
      items: [
        { key: 'crm', label: 'CRM hub', path: '/crm' },
        { key: 'clients', label: 'Klienci', path: '/klienci', activeKey: 'crm' },
        { key: 'quotes', label: 'Kalendarz wycen', path: '/wycena-kalendarz', activeKey: 'schedule' },
        { key: 'fieldQuotes', label: 'Wyceny terenowe', path: '/wyceny-terenowe', activeKey: 'orders' },
        { key: 'approveQuotes', label: 'Zatwierdz wyceny', path: '/zatwierdz-wyceny', activeKey: 'profile' },
      ],
    },
    {
      label: 'Ekipy i flota',
      items: [
        { key: 'teams', label: 'Ekipy', path: '/ekipy' },
        { key: 'fleet', label: 'Flota', path: '/flota' },
        { key: 'warehouse', label: 'Magazyn', path: '/magazyn', activeKey: 'fleet' },
        { key: 'reservations', label: 'Rezerwacje sprzetu', path: '/rezerwacje-sprzetu', activeKey: 'fleet' },
        { key: 'resources', label: 'Kalendarz zasobow', path: '/kalendarz-zasobow', activeKey: 'fleet' },
        { key: 'crewConfirm', label: 'Potwierdzenia ekip', path: '/potwierdzenia-ekip', activeKey: 'teams' },
      ],
    },
    {
      label: 'Firma i raporty',
      items: [
        { key: 'reports', label: 'Raporty', path: '/raporty' },
        { key: 'dailyReport', label: 'Raport dzienny', path: '/raport-dzienny', activeKey: 'reports' },
        { key: 'bi', label: 'BI dashboard', path: '/bi', activeKey: 'reports' },
        { key: 'accounting', label: 'Ksiegowosc', path: '/ksiegowosc', activeKey: 'reports' },
        { key: 'users', label: 'Uzytkownicy', path: '/uzytkownicy', activeKey: 'profile' },
        { key: 'branches', label: 'Oddzialy', path: '/oddzialy', activeKey: 'profile' },
        { key: 'hrDocs', label: 'Kadry dokumenty', path: '/kadry-dokumenty', activeKey: 'profile' },
        { key: 'phone', label: 'Telefonia', path: '/telefonia', activeKey: 'dashboard' },
        { key: 'integrations', label: 'Integracje', path: '/integracje', activeKey: 'dashboard' },
      ],
    },
  ];

  const initials = `${currentUser?.imie?.[0] || 'J'}${currentUser?.nazwisko?.[0] || 'A'}`;
  const name = [currentUser?.imie, currentUser?.nazwisko].filter(Boolean).join(' ') || currentUser?.login || 'Jan Administrator';
  const roleLabel = getRoleDisplayName(currentUser?.rola, currentUser?.rola || 'Operator');
  const branchLabel = currentUser?.oddzial_nazwa || currentUser?.oddzial || (currentUser?.oddzial_id ? `Oddzial #${currentUser.oddzial_id}` : 'Bez oddzialu');
  const photoUrl = currentUser?.profile_photo_url || currentUser?.avatar_url || currentUser?.photo_url || '';
  const currentPath = location.pathname || '/dashboard';
  const navItems = navGroups.flatMap((group) => group.items);
  const hasExactRouteMatch = navItems.some((item) => currentPath === item.path || currentPath.startsWith(`${item.path}/`));
  const isActive = (item) => {
    if (currentPath === item.path || currentPath.startsWith(`${item.path}/`)) return true;
    if (hasExactRouteMatch) return false;
    return (item.activeKey || item.key) === active;
  };

  return (
    <aside className="command-native-sidebar" aria-label="Polska Flora navigation">
      <button type="button" className="command-native-brand" onClick={() => navigate('/dashboard')}>
        <span className="command-native-logo-frame">
          <img src="/brand/polska-flora-logo.svg" alt="" />
        </span>
        <div>
          <strong>Polska Flora</strong>
          <small>Centrum operacyjne</small>
        </div>
      </button>
      <button type="button" className="command-native-session" onClick={() => navigate('/profil')}>
        <span>Twoja rola</span>
        <strong>{roleLabel}</strong>
        <small>{branchLabel}</small>
      </button>
      <nav className="command-native-nav">
        {navGroups.map((group) => (
          <div key={group.label} className="command-native-nav-group">
            <small>{group.label}</small>
            {group.items.map((item) => (
              <button
                key={item.path}
                type="button"
                className={isActive(item) ? 'is-active' : undefined}
                onClick={() => navigate(item.path)}
              >
                <span aria-hidden />
                {item.label}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div className="command-native-actions">
        <span>Szybkie akcje</span>
        <button type="button" onClick={() => navigate('/zadania')}>Moje zadanie</button>
        <button type="button" onClick={() => navigate('/nowe-zlecenie')}>Nowe zlecenie</button>
        <button type="button" aria-label="Otworz klientow" onClick={() => navigate('/klienci')}>Nowy klient</button>
        <button type="button" onClick={onPlanDay || (() => navigate('/harmonogram'))}>Plan dnia</button>
        <button type="button" onClick={() => navigate('/raporty')}>Raport dzienny</button>
      </div>
      <button type="button" className="command-native-system" onClick={() => navigate('/powiadomienia')}>
        <strong>System online</strong>
        <small>Wszystkie uslugi dzialaja</small>
      </button>
      <button type="button" className="command-native-user" onClick={() => navigate('/profil')}>
        <span className={photoUrl ? 'has-photo' : undefined}>
          {photoUrl ? <img src={photoUrl} alt="" /> : initials}
        </span>
        <div>
          <strong>{name}</strong>
          <small>{roleLabel}</small>
        </div>
      </button>
    </aside>
  );
}
