import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Sidebar from '../components/Sidebar';
import PageHeader from '../components/PageHeader';
import StatusMessage from '../components/StatusMessage';
import api from '../api';
import { getStoredToken, authHeaders } from '../utils/storedToken';
import { getApiErrorMessage } from '../utils/apiError';

const STAGES = ['Lead', 'Oferta', 'W realizacji', 'Wygrane', 'Przegrane'];

function formatAmount(value) {
  const num = Number(value || 0);
  return `${num.toLocaleString('pl-PL')} PLN`;
}

function formatActivityWhen(iso, lng) {
  if (!iso) return '—';
  const tag = lng === 'uk' ? 'uk-UA' : lng === 'ru' ? 'ru-RU' : 'pl-PL';
  return new Date(iso).toLocaleString(tag);
}

const EMPTY_FORM = {
  title: '',
  source: 'inne',
  oddzial_id: '',
  owner_user_id: '',
  client_id: '',
  phone: '',
  email: '',
  value: '',
  notes: '',
};

const EMPTY_ACTIVITY = {
  type: 'note',
  text: '',
  due: '',
  durationSec: '',
};

export default function CrmPipeline() {
  const { t, i18n } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [filter, setFilter] = useState({ oddzial_id: '', owner_user_id: '', q: '' });
  const [dragLeadId, setDragLeadId] = useState(null);
  const [leads, setLeads] = useState([]);
  const [oddzialy, setOddzialy] = useState([]);
  const [owners, setOwners] = useState([]);
  const [clients, setClients] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [selectedLeadId, setSelectedLeadId] = useState(null);
  const [activities, setActivities] = useState([]);
  const [activitiesLoading, setActivitiesLoading] = useState(false);
  const [activityForm, setActivityForm] = useState(EMPTY_ACTIVITY);
  const [savingActivity, setSavingActivity] = useState(false);

  const requestHeaders = useMemo(() => authHeaders(getStoredToken()), []);
  const lng = (i18n.language || 'pl').split('-')[0];

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setMsg('');
      const params = {};
      if (filter.oddzial_id) params.oddzial_id = filter.oddzial_id;
      if (filter.owner_user_id) params.owner_user_id = filter.owner_user_id;
      if (filter.q) params.q = filter.q;
      const [leadsRes, oddzialyRes, usersRes, clientsRes] = await Promise.all([
        api.get('/crm/leads', { headers: requestHeaders, params }),
        api.get('/oddzialy', { headers: requestHeaders }).catch(() => ({ data: [] })),
        api.get('/uzytkownicy', { headers: requestHeaders }).catch(() => ({ data: [] })),
        api.get('/klienci', { headers: requestHeaders }).catch(() => ({ data: [] })),
      ]);
      setLeads(Array.isArray(leadsRes.data) ? leadsRes.data : []);
      setOddzialy(Array.isArray(oddzialyRes.data) ? oddzialyRes.data : []);
      setOwners(Array.isArray(usersRes.data) ? usersRes.data : []);
      setClients(Array.isArray(clientsRes.data) ? clientsRes.data : []);
    } catch (e) {
      setMsg(getApiErrorMessage(e, t('crm.pipeline.errors.load', { defaultValue: 'Nie udało się pobrać pipeline CRM.' })));
    } finally {
      setLoading(false);
    }
  }, [filter.oddzial_id, filter.owner_user_id, filter.q, requestHeaders, t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const selectedLead = useMemo(
    () => (selectedLeadId ? leads.find((l) => Number(l.id) === Number(selectedLeadId)) : null),
    [leads, selectedLeadId]
  );

  const loadActivities = useCallback(
    async (leadId) => {
      if (!leadId) {
        setActivities([]);
        return;
      }
      try {
        setActivitiesLoading(true);
        const res = await api.get(`/crm/leads/${leadId}/activities`, { headers: requestHeaders });
        setActivities(Array.isArray(res.data) ? res.data : []);
      } catch (e) {
        setMsg(getApiErrorMessage(e, t('crm.pipeline.errors.activitiesLoad', { defaultValue: 'Nie udało się pobrać aktywności leada.' })));
        setActivities([]);
      } finally {
        setActivitiesLoading(false);
      }
    },
    [requestHeaders, t]
  );

  useEffect(() => {
    if (selectedLeadId) loadActivities(selectedLeadId);
    else setActivities([]);
  }, [selectedLeadId, loadActivities]);

  useEffect(() => {
    if (!selectedLeadId) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setSelectedLeadId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedLeadId]);

  const leadsByStage = useMemo(() => {
    const grouped = Object.fromEntries(STAGES.map((s) => [s, []]));
    for (const lead of leads) {
      const stage = STAGES.includes(lead.stage) ? lead.stage : STAGES[0];
      grouped[stage].push(lead);
    }
    return grouped;
  }, [leads]);

  const handleCreate = async () => {
    if (!form.title.trim() || !form.oddzial_id) {
      setMsg(t('crm.pipeline.errors.required', { defaultValue: 'Wypełnij tytuł i oddział dla leada.' }));
      return;
    }
    try {
      setSaving(true);
      setMsg('');
      await api.post(
        '/crm/leads',
        {
          ...form,
          oddzial_id: Number(form.oddzial_id),
          owner_user_id: form.owner_user_id ? Number(form.owner_user_id) : null,
          client_id: form.client_id ? Number(form.client_id) : null,
          value: Number(form.value || 0),
        },
        { headers: requestHeaders }
      );
      setForm(EMPTY_FORM);
      await loadData();
    } catch (e) {
      setMsg(getApiErrorMessage(e, t('crm.pipeline.errors.create', { defaultValue: 'Nie udało się dodać leada.' })));
    } finally {
      setSaving(false);
    }
  };

  const patchLead = async (leadId, patch) => {
    try {
      await api.patch(`/crm/leads/${leadId}`, patch, { headers: requestHeaders });
      setLeads((prev) => prev.map((lead) => (lead.id === leadId ? { ...lead, ...patch } : lead)));
    } catch (e) {
      setMsg(getApiErrorMessage(e, t('crm.pipeline.errors.update', { defaultValue: 'Nie udało się zaktualizować leada.' })));
      await loadData();
    }
  };

  const handleDelete = async (leadId) => {
    try {
      await api.delete(`/crm/leads/${leadId}`, { headers: requestHeaders });
      setLeads((prev) => prev.filter((lead) => lead.id !== leadId));
      if (Number(selectedLeadId) === Number(leadId)) setSelectedLeadId(null);
    } catch (e) {
      setMsg(getApiErrorMessage(e, t('crm.pipeline.errors.delete', { defaultValue: 'Nie udało się usunąć leada.' })));
    }
  };

  const submitActivity = async () => {
    if (!selectedLeadId || !activityForm.text.trim()) return;
    try {
      setSavingActivity(true);
      const body = {
        type: activityForm.type,
        text: activityForm.text.trim(),
      };
      if (activityForm.type === 'task' && activityForm.due) {
        body.due_at = new Date(activityForm.due).toISOString();
      }
      if (activityForm.type === 'call' && activityForm.durationSec !== '') {
        const n = Number(activityForm.durationSec);
        if (!Number.isNaN(n) && n >= 0) body.call_duration_sec = n;
      }
      await api.post(`/crm/leads/${selectedLeadId}/activities`, body, { headers: requestHeaders });
      setActivityForm(EMPTY_ACTIVITY);
      await loadActivities(selectedLeadId);
      await loadData();
    } catch (e) {
      setMsg(getApiErrorMessage(e, t('crm.pipeline.errors.activitiesAdd', { defaultValue: 'Nie udało się zapisać aktywności.' })));
    } finally {
      setSavingActivity(false);
    }
  };

  const completeActivity = async (activityId) => {
    if (!selectedLeadId) return;
    try {
      await api.patch(
        `/crm/leads/${selectedLeadId}/activities/${activityId}`,
        { completed: true },
        { headers: requestHeaders }
      );
      await loadActivities(selectedLeadId);
      await loadData();
    } catch (e) {
      setMsg(
        getApiErrorMessage(e, t('crm.pipeline.errors.activitiesComplete', { defaultValue: 'Nie udało się oznaczyć zadania jako wykonane.' }))
      );
    }
  };

  const totals = useMemo(() => {
    return STAGES.reduce((acc, stage) => {
      const items = leadsByStage[stage] || [];
      acc[stage] = {
        count: items.length,
        value: items.reduce((sum, lead) => sum + Number(lead.value || 0), 0),
      };
      return acc;
    }, {});
  }, [leadsByStage]);

  const activityTypeLabel = (type) => {
    if (type === 'call') return t('crm.pipeline.activities.typeCall', { defaultValue: 'Telefon' });
    if (type === 'task') return t('crm.pipeline.activities.typeTask', { defaultValue: 'Zadanie / follow-up' });
    return t('crm.pipeline.activities.typeNote', { defaultValue: 'Notatka' });
  };

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="app-main">
        <PageHeader
          title={t('crm.pipeline.title', { defaultValue: 'Pipeline leadów' })}
          subtitle={t('crm.pipeline.subtitle', { defaultValue: 'Zarządzaj etapami, ownerami i wartością szans sprzedaży.' })}
          variant="hero"
        />
        <div className="app-content">
          <StatusMessage message={msg} tone={msg ? 'error' : undefined} />

          <section className="ios-inset" style={{ padding: 12, marginBottom: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 8 }}>
              <input
                className="ios-field"
                placeholder={t('crm.pipeline.newTitle', { defaultValue: 'Nowy lead / temat' })}
                value={form.title}
                onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
              />
              <select className="ios-field" value={form.oddzial_id} onChange={(e) => setForm((prev) => ({ ...prev, oddzial_id: e.target.value }))}>
                <option value="">{t('crm.pipeline.selectBranch', { defaultValue: 'Wybierz oddział' })}</option>
                {oddzialy.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.nazwa || `#${o.id}`}
                  </option>
                ))}
              </select>
              <select className="ios-field" value={form.owner_user_id} onChange={(e) => setForm((prev) => ({ ...prev, owner_user_id: e.target.value }))}>
                <option value="">{t('crm.pipeline.noOwner', { defaultValue: 'Bez ownera' })}</option>
                {owners.map((u) => (
                  <option key={u.id} value={u.id}>
                    {[u.imie, u.nazwisko].filter(Boolean).join(' ') || u.login || `#${u.id}`}
                  </option>
                ))}
              </select>
              <select className="ios-field" value={form.client_id} onChange={(e) => setForm((prev) => ({ ...prev, client_id: e.target.value }))}>
                <option value="">{t('crm.pipeline.noClient', { defaultValue: 'Bez powiązanego klienta' })}</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nazwa || `#${c.id}`}
                  </option>
                ))}
              </select>
              <input
                className="ios-field"
                placeholder={t('crm.pipeline.value', { defaultValue: 'Wartość (PLN)' })}
                type="number"
                min="0"
                value={form.value}
                onChange={(e) => setForm((prev) => ({ ...prev, value: e.target.value }))}
              />
              <button className="ios-btn ios-btn-primary" type="button" disabled={saving} onClick={handleCreate}>
                {t('crm.pipeline.addLead', { defaultValue: 'Dodaj leada' })}
              </button>
            </div>
          </section>

          <section className="ios-inset" style={{ padding: 12, marginBottom: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 8 }}>
              <select
                className="ios-field"
                value={filter.oddzial_id}
                onChange={(e) => setFilter((prev) => ({ ...prev, oddzial_id: e.target.value }))}
              >
                <option value="">{t('crm.pipeline.filters.allBranches', { defaultValue: 'Wszystkie oddziały' })}</option>
                {oddzialy.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.nazwa || `#${o.id}`}
                  </option>
                ))}
              </select>
              <select
                className="ios-field"
                value={filter.owner_user_id}
                onChange={(e) => setFilter((prev) => ({ ...prev, owner_user_id: e.target.value }))}
              >
                <option value="">{t('crm.pipeline.filters.allOwners', { defaultValue: 'Wszyscy ownerzy' })}</option>
                {owners.map((u) => (
                  <option key={u.id} value={u.id}>
                    {[u.imie, u.nazwisko].filter(Boolean).join(' ') || u.login || `#${u.id}`}
                  </option>
                ))}
              </select>
              <input
                className="ios-field"
                value={filter.q}
                onChange={(e) => setFilter((prev) => ({ ...prev, q: e.target.value }))}
                placeholder={t('crm.pipeline.filters.search', { defaultValue: 'Szukaj po kliencie, telefonie, źródle...' })}
              />
            </div>
          </section>

          <section style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(220px, 1fr))', gap: 10, overflowX: 'auto' }}>
            {STAGES.map((stage) => (
              <div
                key={stage}
                className="ios-inset"
                style={{ minHeight: 280, padding: 10 }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={async () => {
                  if (!dragLeadId) return;
                  setDragLeadId(null);
                  await patchLead(dragLeadId, { stage });
                }}
              >
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontWeight: 700 }}>{stage}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {totals[stage]?.count || 0} | {formatAmount(totals[stage]?.value || 0)}
                  </div>
                </div>
                <div className="ios-inset-list">
                  {(leadsByStage[stage] || []).map((lead) => (
                    <div key={lead.id} className="ios-inset-row" style={{ display: 'grid', gap: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        <span
                          draggable
                          onDragStart={(e) => {
                            e.stopPropagation();
                            setDragLeadId(lead.id);
                          }}
                          onDragEnd={() => setDragLeadId(null)}
                          title={t('crm.pipeline.dragHandle', { defaultValue: 'Przenieś między kolumnami' })}
                          aria-label={t('crm.pipeline.dragHandle', { defaultValue: 'Przenieś między kolumnami' })}
                          style={{
                            cursor: 'grab',
                            userSelect: 'none',
                            fontSize: 14,
                            color: 'var(--text-muted)',
                            letterSpacing: -2,
                            lineHeight: 1,
                          }}
                        >
                          ⋮⋮
                        </span>
                        <button type="button" className="ios-btn" style={{ flexShrink: 0 }} onClick={() => setSelectedLeadId(lead.id)}>
                          {t('crm.pipeline.activities.toggleShow', { defaultValue: 'Aktywności' })}
                        </button>
                      </div>
                      <div style={{ fontWeight: 600 }}>{lead.title}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {lead.client_name || lead.phone || lead.email || lead.source || '—'}
                      </div>
                      <div style={{ fontSize: 12 }}>{formatAmount(lead.value)}</div>
                      <select
                        className="ios-field"
                        value={lead.owner_user_id || ''}
                        onChange={(e) => patchLead(lead.id, { owner_user_id: e.target.value ? Number(e.target.value) : null })}
                      >
                        <option value="">{t('crm.pipeline.noOwner', { defaultValue: 'Bez ownera' })}</option>
                        {owners.map((u) => (
                          <option key={u.id} value={u.id}>
                            {[u.imie, u.nazwisko].filter(Boolean).join(' ') || u.login || `#${u.id}`}
                          </option>
                        ))}
                      </select>
                      <button type="button" className="ios-btn" onClick={() => handleDelete(lead.id)}>
                        {t('crm.pipeline.deleteLead', { defaultValue: 'Usuń' })}
                      </button>
                    </div>
                  ))}
                  {!loading && (leadsByStage[stage] || []).length === 0 ? (
                    <div className="ios-inset-row muted">
                      {t('crm.pipeline.emptyStage', { defaultValue: 'Brak leadów na tym etapie.' })}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </section>
        </div>
      </main>

      {selectedLeadId && selectedLead ? (
        <>
          <div
            role="presentation"
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.35)',
              zIndex: 250,
            }}
            onClick={() => setSelectedLeadId(null)}
          />
          <aside
            className="ios-inset"
            style={{
              position: 'fixed',
              right: 0,
              top: 0,
              bottom: 0,
              width: 'min(440px, 100vw)',
              zIndex: 260,
              margin: 0,
              borderRadius: '16px 0 0 16px',
              overflow: 'auto',
              boxShadow: 'var(--shadow-lg)',
              display: 'flex',
              flexDirection: 'column',
              padding: 14,
              gap: 12,
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
                  {t('crm.pipeline.activities.timeline', { defaultValue: 'Historia kontaktu' })}
                </div>
                <div style={{ fontWeight: 800, fontSize: 17 }}>{selectedLead.title}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                  {selectedLead.stage} · {formatAmount(selectedLead.value)}
                  {selectedLead.owner_name ? ` · ${selectedLead.owner_name}` : ''}
                </div>
              </div>
              <button type="button" className="ios-btn" onClick={() => setSelectedLeadId(null)}>
                {t('crm.pipeline.activities.close', { defaultValue: 'Zamknij' })}
              </button>
            </div>

            <div className="ios-inset" style={{ padding: 10, display: 'grid', gap: 8 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                {['note', 'call', 'task'].map((tp) => (
                  <button
                    key={tp}
                    type="button"
                    className="ios-btn"
                    style={{
                      fontWeight: activityForm.type === tp ? 700 : 500,
                      borderColor: activityForm.type === tp ? 'var(--accent)' : undefined,
                    }}
                    onClick={() => setActivityForm((prev) => ({ ...prev, type: tp }))}
                  >
                    {activityTypeLabel(tp)}
                  </button>
                ))}
              </div>
              <textarea
                className="ios-field"
                rows={3}
                value={activityForm.text}
                onChange={(e) => setActivityForm((prev) => ({ ...prev, text: e.target.value }))}
                placeholder={t('crm.pipeline.activities.textPlaceholder', { defaultValue: 'Treść…' })}
              />
              {activityForm.type === 'task' ? (
                <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'grid', gap: 4 }}>
                  {t('crm.pipeline.activities.due', { defaultValue: 'Termin (opcjonalnie)' })}
                  <input
                    className="ios-field"
                    type="datetime-local"
                    value={activityForm.due}
                    onChange={(e) => setActivityForm((prev) => ({ ...prev, due: e.target.value }))}
                  />
                </label>
              ) : null}
              {activityForm.type === 'call' ? (
                <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'grid', gap: 4 }}>
                  {t('crm.pipeline.activities.durationSec', { defaultValue: 'Czas rozmowy (s)' })}
                  <input
                    className="ios-field"
                    type="number"
                    min="0"
                    value={activityForm.durationSec}
                    onChange={(e) => setActivityForm((prev) => ({ ...prev, durationSec: e.target.value }))}
                  />
                </label>
              ) : null}
              <button type="button" className="ios-btn ios-btn-primary" disabled={savingActivity || !activityForm.text.trim()} onClick={submitActivity}>
                {t('crm.pipeline.activities.add', { defaultValue: 'Dodaj wpis' })}
              </button>
            </div>

            {activitiesLoading ? (
              <div className="muted" style={{ fontSize: 13 }}>
                {t('crm.pipeline.activities.loading', { defaultValue: 'Ładowanie…' })}
              </div>
            ) : null}
            <div className="ios-inset-list" style={{ flex: 1, minHeight: 120 }}>
              {activities.map((a) => (
                <div key={a.id} className="ios-inset-row" style={{ display: 'grid', gap: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, fontSize: 12 }}>{activityTypeLabel(a.type)}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {t('crm.pipeline.activities.at', { defaultValue: 'Kiedy' })}: {formatActivityWhen(a.created_at, lng)}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', lineHeight: 1.45 }}>{a.text}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {t('crm.pipeline.activities.by', { defaultValue: 'Kto' })}: {a.author_name || '—'}
                    {a.type === 'call' && a.call_duration_sec != null ? ` · ${a.call_duration_sec}s` : ''}
                    {a.type === 'task' && a.due_at ? ` · ${formatActivityWhen(a.due_at, lng)}` : ''}
                  </div>
                  {a.type === 'task' && !a.completed_at ? (
                    <button type="button" className="ios-btn" onClick={() => completeActivity(a.id)}>
                      {t('crm.pipeline.activities.markDone', { defaultValue: 'Oznacz wykonane' })}
                    </button>
                  ) : null}
                  {a.type === 'task' && a.completed_at ? (
                    <div style={{ fontSize: 11, color: 'var(--accent)' }}>
                      {t('crm.pipeline.activities.done', { defaultValue: 'Wykonane' })}: {formatActivityWhen(a.completed_at, lng)}
                    </div>
                  ) : null}
                </div>
              ))}
              {!activitiesLoading && activities.length === 0 ? (
                <div className="ios-inset-row muted">{t('crm.pipeline.activities.empty', { defaultValue: 'Brak wpisów.' })}</div>
              ) : null}
            </div>
          </aside>
        </>
      ) : null}
    </div>
  );
}
