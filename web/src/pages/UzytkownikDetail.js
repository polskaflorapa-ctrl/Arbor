import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Sidebar from '../components/Sidebar';

/**
 * Trasa `/uzytkownicy/:id` — przekierowanie na listę z otwarciem szczegółów (stan w Uzytkownicy.js).
 */
export default function UzytkownikDetail() {
  const { id } = useParams();
  const navigate = useNavigate();

  useEffect(() => {
    const uid = parseInt(String(id), 10);
    if (Number.isFinite(uid) && uid > 0) {
      navigate('/uzytkownicy', { replace: true, state: { openUserId: uid } });
    } else {
      navigate('/uzytkownicy', { replace: true });
    }
  }, [id, navigate]);

  return (
    <div style={{ display: 'flex', minHeight: '100vh', backgroundColor: 'var(--bg)' }}>
      <Sidebar />
      <div style={{ flex: 1, padding: 24, color: 'var(--text-muted)' }}>Przekierowanie do użytkownika…</div>
    </div>
  );
}
