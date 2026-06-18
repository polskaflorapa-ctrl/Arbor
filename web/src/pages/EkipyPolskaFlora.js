import React, { useMemo, useState } from 'react';
import Sidebar from '../components/Sidebar';
import GroupsOutlined from '@mui/icons-material/GroupsOutlined';
import LocationOnOutlined from '@mui/icons-material/LocationOnOutlined';
import AssignmentOutlined from '@mui/icons-material/AssignmentOutlined';
import PhoneOutlined from '@mui/icons-material/PhoneOutlined';
import ShieldOutlined from '@mui/icons-material/ShieldOutlined';
import CloseOutlined from '@mui/icons-material/CloseOutlined';

const money = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 0 });

function getId(value) {
  return value == null ? '' : String(value);
}

function personName(user) {
  if (!user) return '';
  return [user.imie, user.nazwisko].filter(Boolean).join(' ') || user.name || user.email || `Uzytkownik #${user.id}`;
}

function teamMembers(team, users) {
  const raw = Array.isArray(team.czlonkowie) ? team.czlonkowie : [];
  const ids = raw.map((item) => (typeof item === 'object' ? item.user_id || item.id : item)).filter(Boolean);
  if (ids.length) {
    return ids
      .map((id) => users.find((user) => getId(user.id) === getId(id)))
      .filter(Boolean);
  }
  return users.filter((user) => getId(user.ekipa_id) === getId(team.id));
}

export default function EkipyPolskaFlora({
  ekipy = [],
  filtrowaneEkipy = [],
  uzytkownicy = [],
  oddzialy = [],
  pojazdy = [],
  sprzet = [],
  selectedAssetProblems = [],
  loading = false,
  msg = null,
  canEdit = false,
  onAddTeam,
}) {
  const [selectedTeam, setSelectedTeam] = useState(null);
  const teams = filtrowaneEkipy.length ? filtrowaneEkipy : ekipy;

  const branchById = useMemo(() => new Map(oddzialy.map((branch) => [getId(branch.id), branch])), [oddzialy]);
  const usersById = useMemo(() => new Map(uzytkownicy.map((user) => [getId(user.id), user])), [uzytkownicy]);

  const cards = teams.map((team) => {
    const members = teamMembers(team, uzytkownicy);
    const leader = usersById.get(getId(team.brygadzista_id)) || members.find((user) => getId(user.id) === getId(team.brygadzista_id));
    const branch = branchById.get(getId(team.oddzial_id));
    const vehicles = pojazdy.filter((item) => getId(item.ekipa_id) === getId(team.id));
    const equipment = sprzet.filter((item) => getId(item.ekipa_id) === getId(team.id));
    const activeTasks = Number(team.aktywne_zlecenia || team.activeTasks || 0);
    const value = Number(team.wartosc_miesiaca || team.wartosc || team.totalValue || 0);

    return { team, members, leader, branch, vehicles, equipment, activeTasks, value };
  });

  const selected = selectedTeam ? cards.find((card) => getId(card.team.id) === getId(selectedTeam.id)) : null;

  return (
    <div style={ui.shell}>
      <Sidebar />
      <main style={ui.main}>
        <div style={ui.header}>
          <div>
            <h1 style={ui.title}>Ekipy</h1>
            <p style={ui.subtitle}>Zarzadzanie ekipami terenowymi • {cards.length} ekip</p>
          </div>
          <div style={ui.headerActions}>
            {msg?.text && <span style={{ ...ui.notice, ...(msg.type === 'error' ? ui.noticeError : {}) }}>{msg.text}</span>}
            {canEdit && (
              <button type="button" onClick={onAddTeam} style={ui.primaryButton}>
                + Nowa ekipa
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <div style={ui.empty}>Ladowanie ekip...</div>
        ) : (
          <div style={ui.grid}>
            {cards.map((card) => {
              const isActive = card.team.aktywna !== false && String(card.team.status || '').toLowerCase() !== 'nieaktywna';
              return (
                <button key={card.team.id} type="button" style={ui.card} onClick={() => setSelectedTeam(card.team)}>
                  <div style={ui.cardTop}>
                    <div style={ui.teamIdentity}>
                      <div style={ui.iconBox}><GroupsOutlined fontSize="small" /></div>
                      <div>
                        <h3 style={ui.cardTitle}>{card.team.nazwa || `Ekipa #${card.team.id}`}</h3>
                        <p style={ui.metaLine}><LocationOnOutlined style={ui.tinyIcon} />{card.branch?.nazwa || 'Bez oddzialu'}</p>
                      </div>
                    </div>
                    <span style={{ ...ui.badge, ...(isActive ? ui.badgeOk : ui.badgeMuted) }}>{isActive ? 'Aktywna' : 'Nieaktywna'}</span>
                  </div>

                  <div style={ui.stats}>
                    <div style={ui.stat}>
                      <strong>{card.members.length}</strong>
                      <span>Czlonkow</span>
                    </div>
                    <div style={{ ...ui.stat, background: '#eff6ff' }}>
                      <strong style={{ color: '#2563eb' }}>{card.activeTasks}</strong>
                      <span style={{ color: '#3b82f6' }}>Aktywne</span>
                    </div>
                    <div style={{ ...ui.stat, background: '#ecfdf5' }}>
                      <strong style={{ color: '#059669' }}>{card.value ? `${money.format(card.value / 1000)}k` : '-'}</strong>
                      <span style={{ color: '#10b981' }}>Wartosc zl</span>
                    </div>
                  </div>

                  <div style={ui.leader}>
                    <div style={ui.leaderAvatar}><ShieldOutlined fontSize="small" /></div>
                    <div style={{ minWidth: 0 }}>
                      <p style={ui.leaderLabel}>Brygadzista</p>
                      <p style={ui.leaderName}>{card.leader ? personName(card.leader) : 'Nieprzypisany'}</p>
                    </div>
                    <PhoneOutlined style={{ color: '#d97706', marginLeft: 'auto', fontSize: 18 }} />
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {selected && (
          <div style={ui.drawerLayer}>
            <button type="button" aria-label="Zamknij" style={ui.backdrop} onClick={() => setSelectedTeam(null)} />
            <aside style={ui.drawer}>
              <div style={ui.drawerHeader}>
                <h2 style={ui.drawerTitle}>{selected.team.nazwa || `Ekipa #${selected.team.id}`}</h2>
                <button type="button" style={ui.iconButton} onClick={() => setSelectedTeam(null)}><CloseOutlined fontSize="small" /></button>
              </div>
              <div style={ui.drawerBody}>
                <section style={ui.infoPanel}>
                  <div>
                    <p style={ui.kicker}>Oddzial</p>
                    <strong>{selected.branch?.nazwa || 'Bez oddzialu'}</strong>
                  </div>
                  <div>
                    <p style={ui.kicker}>Zasoby</p>
                    <strong>{selected.vehicles.length} poj. / {selected.equipment.length} sprz.</strong>
                  </div>
                </section>

                <section>
                  <h4 style={ui.sectionTitle}><GroupsOutlined fontSize="small" /> Czlonkowie ({selected.members.length})</h4>
                  <div style={ui.list}>
                    {selected.members.map((member) => {
                      const leader = getId(member.id) === getId(selected.team.brygadzista_id);
                      return (
                        <div key={member.id} style={{ ...ui.memberRow, ...(leader ? ui.memberLeader : {}) }}>
                          <div style={{ ...ui.initials, ...(leader ? ui.initialsLeader : {}) }}>
                            {(member.imie || member.name || '?').slice(0, 1)}{(member.nazwisko || '').slice(0, 1)}
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <strong style={ui.memberName}>{personName(member)}</strong>
                            <p style={ui.memberMeta}>{member.telefon || member.phone || 'Brak telefonu'}</p>
                          </div>
                          {leader && <span style={ui.rolePill}>BRYGADZISTA</span>}
                        </div>
                      );
                    })}
                    {!selected.members.length && <p style={ui.mutedText}>Brak przypisanych czlonkow.</p>}
                  </div>
                </section>

                <section>
                  <h4 style={ui.sectionTitle}><AssignmentOutlined fontSize="small" /> Zasoby i uwagi</h4>
                  <div style={ui.assetBox}>
                    <span>Pojazdy: {selected.vehicles.length}</span>
                    <span>Sprzet: {selected.equipment.length}</span>
                    <span>Problemy: {selectedAssetProblems.length}</span>
                  </div>
                </section>
              </div>
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}

const ui = {
  shell: { display: 'flex', minHeight: '100vh', background: '#f8fafc', color: '#111827' },
  main: { flex: 1, padding: 28, overflowX: 'hidden' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 24 },
  title: { margin: 0, fontSize: 26, lineHeight: 1.2, fontWeight: 800, color: '#111827' },
  subtitle: { margin: '6px 0 0', color: '#6b7280', fontSize: 14 },
  headerActions: { display: 'flex', alignItems: 'center', gap: 10 },
  primaryButton: { border: 0, borderRadius: 10, background: '#059669', color: '#fff', padding: '10px 14px', fontWeight: 800, cursor: 'pointer' },
  notice: { borderRadius: 10, padding: '9px 12px', background: '#ecfdf5', color: '#047857', fontSize: 13, fontWeight: 700 },
  noticeError: { background: '#fef2f2', color: '#b91c1c' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))', gap: 16 },
  card: { position: 'relative', textAlign: 'left', border: '1px solid #e5e7eb', background: '#fff', borderRadius: 12, padding: 20, cursor: 'pointer', boxShadow: '0 8px 24px rgba(15, 23, 42, 0.04)' },
  cardTop: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 18 },
  teamIdentity: { display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 },
  iconBox: { width: 48, height: 48, borderRadius: 12, display: 'grid', placeItems: 'center', color: '#fff', background: 'linear-gradient(135deg, #34d399, #059669)' },
  cardTitle: { margin: 0, fontSize: 16, color: '#111827', fontWeight: 800 },
  metaLine: { margin: '4px 0 0', display: 'flex', alignItems: 'center', gap: 4, color: '#6b7280', fontSize: 12 },
  tinyIcon: { fontSize: 14 },
  badge: { padding: '5px 10px', borderRadius: 999, fontSize: 12, fontWeight: 800, whiteSpace: 'nowrap' },
  badgeOk: { background: '#d1fae5', color: '#047857' },
  badgeMuted: { background: '#f3f4f6', color: '#6b7280' },
  stats: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 },
  stat: { borderRadius: 10, padding: '10px 8px', background: '#f9fafb', textAlign: 'center' },
  leader: { display: 'flex', alignItems: 'center', gap: 10, borderRadius: 10, padding: 12, background: '#fffbeb' },
  leaderAvatar: { width: 32, height: 32, borderRadius: 999, display: 'grid', placeItems: 'center', color: '#b45309', background: '#fde68a' },
  leaderLabel: { margin: 0, color: '#d97706', fontSize: 12, fontWeight: 800 },
  leaderName: { margin: '2px 0 0', color: '#78350f', fontSize: 14, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  empty: { border: '1px solid #e5e7eb', borderRadius: 12, background: '#fff', padding: 36, textAlign: 'center', color: '#6b7280' },
  drawerLayer: { position: 'fixed', inset: 0, zIndex: 60, display: 'flex', justifyContent: 'flex-end' },
  backdrop: { position: 'absolute', inset: 0, border: 0, background: 'rgba(15, 23, 42, 0.42)' },
  drawer: { position: 'relative', width: 'min(100%, 440px)', background: '#fff', height: '100%', overflowY: 'auto', boxShadow: '-24px 0 60px rgba(15, 23, 42, 0.22)' },
  drawerHeader: { position: 'sticky', top: 0, zIndex: 1, background: '#fff', borderBottom: '1px solid #e5e7eb', padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  drawerTitle: { margin: 0, fontSize: 18, color: '#111827' },
  iconButton: { border: 0, borderRadius: 10, width: 36, height: 36, display: 'grid', placeItems: 'center', background: '#f3f4f6', cursor: 'pointer' },
  drawerBody: { padding: 22, display: 'grid', gap: 22 },
  infoPanel: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, borderRadius: 12, background: '#ecfdf5', padding: 16, color: '#064e3b' },
  kicker: { margin: '0 0 4px', fontSize: 12, color: '#059669' },
  sectionTitle: { margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: '#374151' },
  list: { display: 'grid', gap: 8 },
  memberRow: { display: 'flex', alignItems: 'center', gap: 10, borderRadius: 10, background: '#f9fafb', padding: 12 },
  memberLeader: { background: '#fffbeb', border: '1px solid #fde68a' },
  initials: { width: 38, height: 38, borderRadius: 999, display: 'grid', placeItems: 'center', background: '#9ca3af', color: '#fff', fontWeight: 900 },
  initialsLeader: { background: '#f59e0b' },
  memberName: { display: 'block', color: '#111827', fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  memberMeta: { margin: '2px 0 0', color: '#6b7280', fontSize: 12 },
  rolePill: { marginLeft: 'auto', borderRadius: 6, padding: '3px 6px', background: '#fde68a', color: '#92400e', fontSize: 10, fontWeight: 900 },
  mutedText: { margin: 0, color: '#9ca3af', fontSize: 14, textAlign: 'center', padding: 14 },
  assetBox: { display: 'grid', gap: 8, borderRadius: 12, background: '#f9fafb', padding: 14, color: '#374151', fontSize: 14 },
};
