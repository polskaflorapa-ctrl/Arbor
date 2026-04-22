import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import CheckOutlined from '@mui/icons-material/CheckOutlined';
import DeleteOutline from '@mui/icons-material/DeleteOutline';
import SettingsOutlined from '@mui/icons-material/SettingsOutlined';
import api from '../api';
import PageHeader from '../components/PageHeader';
import StatusMessage from '../components/StatusMessage';
import { getApiErrorMessage } from '../utils/apiError';
import { getStoredToken, authHeaders } from '../utils/storedToken';
import { errorMessage, successMessage } from '../utils/statusMessage';

// ─── Kolory ról (fallback jeśli brak w DB) ───────────────────
const DEFAULT_ROLE_COLORS = {
  Dyrektor: '#8B5CF6',
  Administrator: '#F59E0B',
  Kierownik: '#3B82F6',
  Brygadzista: '#10B981',
  Specjalista: '#06B6D4',
  Wyceniający: '#A78BFA',
  Pomocnik: '#94A3B8',
  'Pomocnik bez doświadczenia': '#64748B',
  Magazynier: '#F97316',
};

// ─── Grupy uprawnień (schemat) ───────────────────────────────
const PERMISSIONS_SCHEMA = [
  { group: 'Zlecenia', perms: [
    { key: 'zlecenia_widok',         label: 'Przeglądanie' },
    { key: 'zlecenia_tworzenie',     label: 'Tworzenie' },
    { key: 'zlecenia_edycja',        label: 'Edycja' },
    { key: 'zlecenia_usuniecie',     label: 'Usuwanie' },
    { key: 'zlecenia_zmiana_statusu',label: 'Zmiana statusu' },
  ]},
  { group: 'Wyceny', perms: [
    { key: 'wyceny_widok',        label: 'Przeglądanie' },
    { key: 'wyceny_tworzenie',    label: 'Tworzenie' },
    { key: 'wyceny_zatwierdzanie',label: 'Zatwierdzanie' },
  ]},
  { group: 'Dniówki', perms: [
    { key: 'dniowki_widok',        label: 'Przeglądanie' },
    { key: 'dniowki_zatwierdzanie',label: 'Zatwierdzanie' },
  ]},
  { group: 'Użytkownicy', perms: [
    { key: 'uzytkownicy_widok',     label: 'Przeglądanie' },
    { key: 'uzytkownicy_tworzenie', label: 'Tworzenie' },
    { key: 'uzytkownicy_edycja',    label: 'Edycja' },
    { key: 'uzytkownicy_usuniecie', label: 'Usuwanie' },
    { key: 'role_zarzadzanie',      label: 'Zarządzanie rolami' },
  ]},
  { group: 'Raporty / Rozliczenia', perms: [
    { key: 'raporty_widok',    label: 'Raporty' },
    { key: 'raporty_eksport',  label: 'Eksport' },
    { key: 'rozliczenia_widok',label: 'Rozliczenia' },
  ]},
  { group: 'Harmonogram / Ekipy', perms: [
    { key: 'harmonogram_widok',  label: 'Widok' },
    { key: 'harmonogram_edycja', label: 'Edycja' },
    { key: 'ekipy_zarzadzanie',  label: 'Zarządzanie ekipami' },
  ]},
  { group: 'Flota / Oddziały', perms: [
    { key: 'flota_widok',          label: 'Widok floty' },
    { key: 'flota_zarzadzanie',    label: 'Zarządzanie flotą' },
    { key: 'oddzialy_zarzadzanie', label: 'Oddziały' },
  ]},
];

function emptyPermissions() {
  const p = {};
  PERMISSIONS_SCHEMA.forEach(g => g.perms.forEach(x => { p[x.key] = false; }));
  return p;
}

export default function ZarzadzajRolami() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [role, setRole] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);   // rola otwarta w edytorze
  const [editForm, setEditForm] = useState(null);
  const [newForm, setNewForm] = useState(null);      // null = ukryty formularz nowej roli
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [usersMap, setUsersMap] = useState({});

  useEffect(() => { load(); }, []);

  const load = async () => {
    try {
      const token = getStoredToken();
      const h = authHeaders(token);
      const [roleRes, usersRes] = await Promise.all([
        api.get('/role', { headers: h }),
        api.get('/uzytkownicy', { headers: h }),
      ]);
      setRole(roleRes.data);
      // Zlicz użytkowników po nazwie roli, bez dodatkowych zapytań per rola
      const counts = {};
      const users = Array.isArray(usersRes.data) ? usersRes.data : [];
      roleRes.data.forEach((r) => {
        counts[r.id] = users.filter((u) => u.rola === r.nazwa).length;
      });
      setUsersMap(counts);
    } catch { setMsg(errorMessage('Błąd ładowania ról')); }
    finally { setLoading(false); }
  };

  const openEdit = (r) => {
    setSelected(r);
    setEditForm({
      nazwa: r.nazwa,
      kolor: r.kolor || DEFAULT_ROLE_COLORS[r.nazwa] || '#94A3B8',
      opis: r.opis || '',
      poziom: r.poziom || 1,
      aktywna: r.aktywna !== false,
      uprawnienia: { ...emptyPermissions(), ...(r.uprawnienia || {}) },
    });
    setNewForm(null);
  };

  const openNew = () => {
    setSelected(null);
    setNewForm({
      nazwa: '',
      kolor: '#34D399',
      opis: '',
      poziom: 1,
      uprawnienia: emptyPermissions(),
    });
  };

  const handleSave = async () => {
    setSaving(true); setMsg('');
    try {
      const token = getStoredToken();
      const h = authHeaders(token);
      if (selected) {
        await api.put(`/role/${selected.id}`, editForm, { headers: h });
        setMsg(successMessage('Rola zaktualizowana'));
      } else {
        await api.post('/role', newForm, { headers: h });
        setMsg(successMessage('Rola utworzona'));
        setNewForm(null);
      }
      load();
    } catch (e) {
      setMsg(errorMessage(getApiErrorMessage(e, 'Błąd zapisu')));
    } finally { setSaving(false); }
  };

  const handleDelete = async (r) => {
    if (!window.confirm(`Usunąć rolę "${r.nazwa}"? Tej operacji nie można cofnąć.`)) return;
    try {
      const token = getStoredToken();
      await api.delete(`/role/${r.id}`, { headers: authHeaders(token) });
      setMsg(successMessage('Rola usunięta'));
      if (selected?.id === r.id) setSelected(null);
      load();
    } catch (e) {
      setMsg(errorMessage(getApiErrorMessage(e, 'Błąd')));
    }
  };

  const togglePerm = (key, form, setForm) => {
    setForm(f => ({
      ...f,
      uprawnienia: { ...f.uprawnienia, [key]: !f.uprawnienia[key] },
    }));
  };

  const setGroupAll = (group, val, form, setForm) => {
    const updates = {};
    group.perms.forEach(p => { updates[p.key] = val; });
    setForm(f => ({ ...f, uprawnienia: { ...f.uprawnienia, ...updates } }));
  };

  const form = selected ? editForm : newForm;
  const setForm = selected ? setEditForm : setNewForm;
  const canSaveRole = Boolean(form?.nazwa?.trim());

  return (
    <div style={S.page}>
      <PageHeader
        variant="plain"
        title={t('pages.role.title')}
        subtitle={t('pages.role.subtitle')}
        icon={<SettingsOutlined style={{ fontSize: 26 }} />}
        back={{ onClick: () => navigate('/dashboard'), label: t('nav.dashboard'), ariaLabel: t('pages.role.backToDashboard') }}
        actions={
          <button type="button" style={S.btnAdd} onClick={openNew}>
            + {t('pages.role.newRole')}
          </button>
        }
      />

      <StatusMessage message={msg} style={S.msgBar} />

      <div style={S.layout}>
        {/* ─── LISTA RÓL ────────────────────────────────────── */}
        <div style={S.sidebar}>
          <div style={S.sidebarHeader}>
            <span style={S.sidebarTitle}>Role ({role.length})</span>
          </div>

          {loading ? (
            <div style={S.center}>Ładowanie...</div>
          ) : (
            role.map(r => {
              const color = r.kolor || DEFAULT_ROLE_COLORS[r.nazwa] || '#94A3B8';
              return (
                <div
                  key={r.id}
                  style={{
                    ...S.roleRow,
                    background: selected?.id === r.id ? '#1E3A5F' : 'transparent',
                    borderLeftColor: color,
                    opacity: r.aktywna === false ? 0.5 : 1,
                  }}
                  onClick={() => openEdit(r)}
                >
                  <div style={S.roleRowLeft}>
                    <span style={{ ...S.roleDot, background: color }} />
                    <div>
                      <div style={S.roleName}>{r.nazwa}</div>
                      <div style={S.roleMeta}>
                        Poziom {r.poziom} · {usersMap[r.id] ?? '–'} użytkowników
                      </div>
                    </div>
                  </div>
                  <div style={S.roleRowRight}>
                    {r.stala && <span style={S.tagSystem}>system</span>}
                    {r.aktywna === false && <span style={S.tagInactive}>nieaktywna</span>}
                    {!r.stala && (
                      <button
                        type="button"
                        style={S.btnDel}
                        onClick={(e) => { e.stopPropagation(); handleDelete(r); }}
                        title={t('common.delete')}
                        aria-label={t('common.delete')}
                      >
                        <DeleteOutline sx={{ fontSize: 18, color: '#F87171' }} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* ─── EDYTOR ──────────────────────────────────────── */}
        <div style={S.editor}>
          {!form ? (
            <div style={S.emptyEditor}>
              <SettingsOutlined sx={{ fontSize: 48, color: '#64748B' }} />
              <p style={{ color: '#64748B', marginTop: 12 }}>
                {t('pages.role.pickOrCreate')}
              </p>
            </div>
          ) : (
            <>
              <div style={S.editorHeader}>
                <h2 style={S.editorTitle}>
                  {selected ? `Edytuj: ${selected.nazwa}` : 'Nowa rola'}
                </h2>
                {selected?.stala && (
                  <span style={S.tagSystem}>rola systemowa — nazwa i poziom zablokowane</span>
                )}
              </div>

              {/* ── Podstawowe dane ── */}
              <div style={S.formRow}>
                <div style={S.formGroup}>
                  <label style={S.label}>Nazwa roli *</label>
                  <input
                    style={{ ...S.input, opacity: selected?.stala ? 0.5 : 1 }}
                    value={form.nazwa}
                    disabled={!!selected?.stala}
                    onChange={e => setForm(f => ({ ...f, nazwa: e.target.value }))}
                    placeholder="np. Specjalista ds. nasadzeń"
                  />
                </div>
                <div style={S.formGroup}>
                  <label style={S.label}>Kolor</label>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      type="color"
                      value={form.kolor}
                      onChange={e => setForm(f => ({ ...f, kolor: e.target.value }))}
                      style={{ width: 44, height: 36, border: 'none', background: 'none',
                        cursor: 'pointer', padding: 0, borderRadius: 6 }}
                    />
                    <input
                      style={{ ...S.input, flex: 1 }}
                      value={form.kolor}
                      onChange={e => setForm(f => ({ ...f, kolor: e.target.value }))}
                      placeholder="#34D399"
                    />
                  </div>
                </div>
              </div>

              <div style={S.formRow}>
                <div style={{ ...S.formGroup, flex: 2 }}>
                  <label style={S.label}>Opis</label>
                  <input
                    style={S.input}
                    value={form.opis}
                    onChange={e => setForm(f => ({ ...f, opis: e.target.value }))}
                    placeholder="Krótki opis roli..."
                  />
                </div>
                <div style={S.formGroup}>
                  <label style={S.label}>Poziom (1–10)</label>
                  <input
                    type="number" min="1" max="10"
                    style={{ ...S.input, opacity: selected?.stala ? 0.5 : 1 }}
                    value={form.poziom}
                    disabled={!!selected?.stala}
                    onChange={e => setForm(f => ({ ...f, poziom: parseInt(e.target.value) || 1 }))}
                  />
                </div>
                {selected && (
                  <div style={S.formGroup}>
                    <label style={S.label}>Aktywna</label>
                    <div style={{ paddingTop: 6 }}>
                      <ToggleSwitch
                        value={form.aktywna}
                        onChange={v => setForm(f => ({ ...f, aktywna: v }))}
                        disabled={!!selected?.stala}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* ── Uprawnienia ── */}
              <div style={S.permsSection}>
                <div style={S.permsSectionHeader}>
                  <span style={S.permsSectionTitle}>Uprawnienia</span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button style={S.btnSmall} onClick={() => {
                      const all = {};
                      PERMISSIONS_SCHEMA.forEach(g => g.perms.forEach(p => { all[p.key] = true; }));
                      setForm(f => ({ ...f, uprawnienia: all }));
                    }}>Zaznacz wszystkie</button>
                    <button style={S.btnSmall} onClick={() => {
                      setForm(f => ({ ...f, uprawnienia: emptyPermissions() }));
                    }}>Odznacz wszystkie</button>
                  </div>
                </div>

                <div style={S.permsGrid}>
                  {PERMISSIONS_SCHEMA.map(group => {
                    const allOn = group.perms.every(p => form.uprawnienia[p.key]);
                    return (
                      <div key={group.group} style={S.permGroup}>
                        <div style={S.permGroupHeader}>
                          <span style={S.permGroupTitle}>{group.group}</span>
                          <button
                            style={{ ...S.btnTiny, color: allOn ? '#EF4444' : '#34D399' }}
                            onClick={() => setGroupAll(group, !allOn, form, setForm)}
                          >
                            {allOn ? t('pages.role.deselectGroup') : t('pages.role.selectGroup')}
                          </button>
                        </div>
                        {group.perms.map(p => (
                          <label key={p.key} style={S.permRow}>
                            <input
                              type="checkbox"
                              checked={!!form.uprawnienia[p.key]}
                              onChange={() => togglePerm(p.key, form, setForm)}
                              style={{ accentColor: '#34D399', width: 15, height: 15 }}
                            />
                            <span style={{
                              ...S.permLabel,
                              color: form.uprawnienia[p.key] ? '#E2E8F0' : '#64748B',
                            }}>
                              {p.label}
                            </span>
                            {form.uprawnienia[p.key] && (
                              <span style={S.permOn}><CheckOutlined sx={{ fontSize: 14, color: '#34D399' }} /></span>
                            )}
                          </label>
                        ))}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* ── Podsumowanie uprawnień ── */}
              <PermissionSummary uprawnienia={form.uprawnienia} kolor={form.kolor} />

              {/* ── Akcje ── */}
              <div style={S.actions}>
                <button
                  style={S.btnCancel}
                  onClick={() => { setSelected(null); setNewForm(null); }}
                >
                  Anuluj
                </button>
                <button
                  style={{ ...S.btnSave, opacity: saving ? 0.6 : 1 }}
                  onClick={handleSave}
                  disabled={saving || !canSaveRole}
                >
                  {saving ? t('common.saving') : (selected ? t('pages.role.saveChanges') : t('pages.role.createRole'))}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Podsumowanie uprawnień jako tag chmura ──────────────────
function PermissionSummary({ uprawnienia, kolor }) {
  const { t } = useTranslation();
  const active = Object.entries(uprawnienia || {})
    .filter(([, v]) => v)
    .map(([k]) => {
      for (const g of PERMISSIONS_SCHEMA) {
        const p = g.perms.find(x => x.key === k);
        if (p) return `${g.group}: ${p.label}`;
      }
      return k;
    });

  if (!active.length) return (
    <div style={S.summaryBox}>
      <span style={{ color: '#EF4444', fontSize: 13 }}>{t('pages.role.noPermsWarning')}</span>
    </div>
  );

  return (
    <div style={S.summaryBox}>
      <span style={{ color: '#94A3B8', fontSize: 12, marginBottom: 6, display: 'block' }}>
        Aktywne uprawnienia ({active.length}):
      </span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
        {active.map(a => (
          <span key={a} style={{ ...S.summaryTag, borderColor: kolor || '#34D399', color: kolor || '#34D399' }}>
            {a}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Toggle switch ───────────────────────────────────────────
function ToggleSwitch({ value, onChange, disabled }) {
  return (
    <div
      onClick={() => !disabled && onChange(!value)}
      style={{
        width: 44, height: 24, borderRadius: 12,
        background: value ? '#34D399' : '#1E3A5F',
        position: 'relative', cursor: disabled ? 'default' : 'pointer',
        transition: 'background .2s', opacity: disabled ? 0.5 : 1,
      }}
    >
      <div style={{
        position: 'absolute', top: 2,
        left: value ? 22 : 2,
        width: 20, height: 20, borderRadius: 10,
        background: '#fff', transition: 'left .2s',
        boxShadow: '0 1px 3px rgba(0,0,0,.4)',
      }} />
    </div>
  );
}

// ─── Styles ─────────────────────────────────────────────────
const S = {
  page: {
    minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)',
    padding: '28px 24px',
  },
  btnAdd: {
    background: '#34D399', color: '#052E16', border: 'none', borderRadius: 10,
    padding: '10px 20px', fontWeight: 700, fontSize: 14, cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  msgBar: { marginBottom: 16 },

  layout: { display: 'flex', gap: 20, alignItems: 'flex-start' },

  // Sidebar
  sidebar: {
    width: 280, minWidth: 240, background: 'var(--bg-card)',
    borderRadius: 14, border: '1px solid var(--border)',
    overflow: 'hidden', flexShrink: 0,
  },
  sidebarHeader: {
    padding: '14px 16px', borderBottom: '1px solid var(--border)',
    background: 'var(--bg-deep)',
  },
  sidebarTitle: { fontSize: 13, fontWeight: 700, color: 'var(--text-sub)', textTransform: 'uppercase', letterSpacing: 1 },
  roleRow: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '12px 14px', cursor: 'pointer', borderLeft: '3px solid transparent',
    transition: 'background .15s',
  },
  roleRowLeft: { display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 },
  roleRowRight: { display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 },
  roleDot: { width: 10, height: 10, borderRadius: 5, flexShrink: 0 },
  roleName: { fontSize: 14, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  roleMeta: { fontSize: 11, color: 'var(--text-muted)', marginTop: 1 },
  tagSystem: {
    fontSize: 10, padding: '2px 6px', borderRadius: 4, background: '#1E3A5F',
    color: '#60A5FA', fontWeight: 600,
  },
  tagInactive: {
    fontSize: 10, padding: '2px 6px', borderRadius: 4, background: '#450A0A',
    color: '#FCA5A5', fontWeight: 600,
  },
  btnDel: {
    background: 'none', border: 'none', cursor: 'pointer',
    padding: '4px 6px', opacity: 0.85, display: 'inline-flex', alignItems: 'center',
  },

  // Editor
  editor: {
    flex: 1, background: 'var(--bg-card)', borderRadius: 14,
    border: '1px solid var(--border)', padding: 24, minHeight: 500,
  },
  emptyEditor: { height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 400 },
  editorHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  editorTitle: { margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text)' },

  formRow: { display: 'flex', gap: 16, marginBottom: 4, flexWrap: 'wrap' },
  formGroup: { flex: 1, minWidth: 140, marginBottom: 14 },
  label: { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-sub)', marginBottom: 6 },
  input: {
    width: '100%', background: 'var(--bg-deep)', border: '1px solid var(--border)',
    borderRadius: 8, color: 'var(--text)', padding: '9px 12px', fontSize: 14,
    boxSizing: 'border-box',
  },

  // Permissions
  permsSection: { marginTop: 20 },
  permsSectionHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 14,
  },
  permsSectionTitle: { fontSize: 15, fontWeight: 700, color: 'var(--text)' },
  btnSmall: {
    background: 'var(--bg-deep)', border: '1px solid var(--border)', borderRadius: 6,
    color: 'var(--text-sub)', fontSize: 12, padding: '5px 10px', cursor: 'pointer',
  },
  permsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
    gap: 12,
  },
  permGroup: {
    background: 'var(--bg-deep)', borderRadius: 10, padding: 12,
    border: '1px solid var(--border)',
  },
  permGroupHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 10,
  },
  permGroupTitle: { fontSize: 12, fontWeight: 700, color: 'var(--text-sub)', textTransform: 'uppercase', letterSpacing: 0.5 },
  btnTiny: { background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600, padding: '2px 4px' },
  permRow: {
    display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0',
    cursor: 'pointer', userSelect: 'none',
  },
  permLabel: { fontSize: 13, flex: 1, transition: 'color .1s' },
  permOn: { display: 'inline-flex', alignItems: 'center' },

  summaryBox: {
    marginTop: 20, background: 'var(--bg-deep)', borderRadius: 10,
    padding: 14, border: '1px solid var(--border)',
  },
  summaryTag: {
    fontSize: 11,
    padding: '3px 8px',
    borderRadius: 6,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    background: 'transparent',
  },

  actions: { display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 24 },
  btnCancel: {
    background: 'var(--bg-deep)', border: '1px solid var(--border)',
    color: 'var(--text-sub)', borderRadius: 10, padding: '10px 20px',
    cursor: 'pointer', fontSize: 14,
  },
  btnSave: {
    background: '#34D399', color: '#052E16', border: 'none', borderRadius: 10,
    padding: '10px 24px', fontWeight: 700, fontSize: 14, cursor: 'pointer',
  },
  center: { display: 'flex', justifyContent: 'center', padding: 24, color: '#64748B' },
};
