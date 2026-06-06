import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { readStoredUser } from '../utils/readStoredUser';

export default function CommandSidebar({ active = 'dashboard', user = null, onPlanDay = null }) {
  const navigate = useNavigate();
  const currentUser = useMemo(() => user || readStoredUser() || {}, [user]);
  const nav = [
    { key: 'dashboard', label: 'Pulpit', path: '/dashboard' },
    { key: 'profile', label: 'Profil', path: '/profil' },
    { key: 'orders', label: 'Zlecenia', path: '/zlecenia' },
    { key: 'crm', label: 'CRM hub', path: '/crm' },
    { key: 'schedule', label: 'Harmonogram', path: '/harmonogram' },
    { key: 'teams', label: 'Ekipy', path: '/ekipy' },
    { key: 'fleet', label: 'Flota', path: '/flota' },
    { key: 'reports', label: 'Raporty', path: '/raporty' },
  ];

  const initials = `${currentUser?.imie?.[0] || 'J'}${currentUser?.nazwisko?.[0] || 'A'}`;
  const name = [currentUser?.imie, currentUser?.nazwisko].filter(Boolean).join(' ') || currentUser?.login || 'Jan Administrator';
  const photoUrl = currentUser?.profile_photo_url || currentUser?.avatar_url || currentUser?.photo_url || '';

  return (
    <aside className="command-native-sidebar" aria-label="ARBOR Command navigation">
      <button type="button" className="command-native-brand" onClick={() => navigate('/dashboard')}>
        <span>AR</span>
        <div>
          <strong>ARBOR-OS</strong>
          <small>System zarzadzania</small>
        </div>
      </button>
      <nav className="command-native-nav">
        {nav.map((item) => (
          <button
            key={item.path}
            type="button"
            className={item.key === active ? 'is-active' : undefined}
            onClick={() => navigate(item.path)}
          >
            <span aria-hidden />
            {item.label}
          </button>
        ))}
      </nav>
      <div className="command-native-actions">
        <span>Szybkie akcje</span>
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
          <small>{currentUser?.rola || 'Operator'}</small>
        </div>
      </button>
    </aside>
  );
}
