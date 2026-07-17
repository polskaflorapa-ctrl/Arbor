import { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  CalendarDays,
  ClipboardList,
  CloudSun,
  ContactRound,
  FileSignature,
  History,
  LayoutDashboard,
  Map,
  Package,
  ReceiptText,
  Settings,
  ShieldCheck,
  Truck,
  UsersRound,
} from 'lucide-react';
import { readStoredUser } from '../utils/readStoredUser';
import { getRoleDisplayName } from '../utils/roleDisplay';
import BrandLogo from './BrandLogo';

export default function CommandSidebar({ active = 'dashboard', user = null, onPlanDay = null }) {
  const navigate = useNavigate();
  const location = useLocation();
  const currentUser = useMemo(() => user || readStoredUser() || {}, [user]);
  const navGroups = [{
    label: 'Arbor OS',
    items: [
      { key: 'dashboard', label: 'Pulpit', path: '/dashboard', Icon: LayoutDashboard },
      { key: 'orders', label: 'Zlecenia', path: '/zlecenia', Icon: ClipboardList },
      { key: 'map', label: 'Mapa', path: '/mapa-live', Icon: Map },
      { key: 'schedule', label: 'Grafik', path: '/harmonogram', Icon: CalendarDays },
      { key: 'clients', label: 'Klienci', path: '/klienci', Icon: ContactRound },
      { key: 'reports', label: 'Raporty', path: '/raporty', Icon: BarChart3 },
      { key: 'quotes', label: 'Oferty', path: '/wycena-kalendarz', Icon: FileSignature },
      { key: 'accounting', label: 'Faktury', path: '/ksiegowosc', Icon: ReceiptText },
      { key: 'teams', label: 'Ekipy', path: '/ekipy', Icon: UsersRound },
      { key: 'fleet', label: 'Flota', path: '/flota', Icon: Truck },
      { key: 'warehouse', label: 'Magazyn', path: '/magazyn', Icon: Package },
      { key: 'audit', label: 'Audyt', path: '/kontrola-operacyjna', Icon: History },
      { key: 'settings', label: 'Ustawienia', path: '/integracje', Icon: Settings },
      { key: 'hrDocs', label: 'Kadry / BHP', path: '/kadry-dokumenty', Icon: ShieldCheck },
    ],
  }];

  const initials = `${currentUser?.imie?.[0] || 'J'}${currentUser?.nazwisko?.[0] || 'A'}`;
  const name = [currentUser?.imie, currentUser?.nazwisko].filter(Boolean).join(' ') || currentUser?.login || 'Jan Administrator';
  const roleLabel = getRoleDisplayName(currentUser?.rola, currentUser?.rola || 'Operator');
  const branchLabel = currentUser?.oddzial_nazwa || currentUser?.oddzial || (currentUser?.oddzial_id ? `Oddzial #${currentUser.oddzial_id}` : 'Bez oddzialu');
  const photoUrl = currentUser?.profile_photo_url || currentUser?.avatar_url || currentUser?.photo_url || '';
  const weatherLocation = String(branchLabel || 'Warszawa').replace(/^Oddzial\s*/i, '') || 'Warszawa';
  const currentTime = new Date().toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
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
        <BrandLogo
          background="dark"
          withDescriptor
          responsiveVertical
          className="command-native-logo-frame"
          alt="Polska Flora"
        />
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
                <span className="command-native-nav-icon" aria-hidden>
                  <item.Icon size={18} strokeWidth={1.8} />
                </span>
                {item.label}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <button type="button" className="command-native-weather" onClick={onPlanDay || (() => navigate('/harmonogram'))}>
        <span>
          <small>Pogoda · {weatherLocation}</small>
          <b><CloudSun size={14} aria-hidden /> {currentTime}</b>
        </span>
        <strong>18°</strong>
        <em>Pochmurno · wiatr 24 km/h</em>
      </button>
      <button type="button" className="command-native-user" onClick={() => navigate('/profil')}>
        <span className={photoUrl ? 'has-photo' : undefined}>
          {photoUrl ? <img src={photoUrl} alt="" /> : initials}
        </span>
        <div>
          <strong>{name}</strong>
          <small>{roleLabel} · {branchLabel}</small>
        </div>
      </button>
    </aside>
  );
}
