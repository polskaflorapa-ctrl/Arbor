/* global fetch, localStorage, FormData, URL, Blob, alert, document, window */
(function () {
  const LS_TOKEN = 'arbor_token';
  const LS_USER = 'arbor_user';

  const $ = (sel) => document.querySelector(sel);
  const state = {
    token: null,
    user: null,
    godzinyLast: { path: '', label: '' },
  };

  /** Widoczność pozycji menu: brak wpisu = wszyscy; tablica = tylko wymienione role. */
  const NAV_RESTRICT = {
    'panel-klienci': ['Kierownik', 'Dyrektor', 'Administrator', 'Brygadzista'],
    'panel-wyceny': ['Kierownik', 'Dyrektor', 'Administrator', 'Brygadzista'],
    'panel-ogledziny': ['Kierownik', 'Dyrektor', 'Administrator', 'Brygadzista'],
    'panel-organizacja': ['Kierownik', 'Dyrektor', 'Administrator'],
    'panel-sms-ai': ['Kierownik', 'Dyrektor', 'Administrator'],
    'panel-ksiegowosc': ['Kierownik', 'Dyrektor', 'Administrator'],
    'panel-audit': ['Dyrektor', 'Administrator'],
  };

  function canAccessPanel(panelId) {
    const r = state.user?.rola;
    const list = NAV_RESTRICT[panelId];
    if (!list) return true;
    return list.includes(r);
  }

  function applyNavVisibilityForRole() {
    document.querySelectorAll('.nav-item[data-panel]').forEach((btn) => {
      const pid = btn.dataset.panel;
      btn.hidden = !canAccessPanel(pid);
    });
    document.querySelectorAll('.nav-group').forEach((grp) => {
      const any = [...grp.querySelectorAll('.nav-item')].some((b) => !b.hidden);
      grp.hidden = !any;
    });
  }

  function applyZleceniaCardsForRole() {
    const team = isTeamRole();
    ['card-zlecenia-stats', 'card-zlecenia-wszystkie', 'card-zlecenia-nowe'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.hidden = team;
    });
  }

  function loadState() {
    state.token = localStorage.getItem(LS_TOKEN);
    try {
      state.user = JSON.parse(localStorage.getItem(LS_USER) || 'null');
    } catch {
      state.user = null;
    }
  }

  function saveState(token, user) {
    state.token = token;
    state.user = user;
    if (token) localStorage.setItem(LS_TOKEN, token);
    else localStorage.removeItem(LS_TOKEN);
    if (user) localStorage.setItem(LS_USER, JSON.stringify(user));
    else localStorage.removeItem(LS_USER);
  }

  function isTeamRole() {
    const r = state.user?.rola;
    return r === 'Brygadzista' || r === 'Pomocnik';
  }

  function canTelefon() {
    return !isTeamRole();
  }

  async function api(path, opts = {}) {
    const { headers: hdrIn, ...rest } = opts;
    const headers = new Headers(hdrIn || {});
    if (state.token) headers.set('Authorization', `Bearer ${state.token}`);
    if (!(opts.body instanceof FormData) && opts.body != null && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    const res = await fetch(`/api${path}`, { ...rest, headers });
    const ct = res.headers.get('content-type') || '';
    let data = null;
    if (ct.includes('application/json')) data = await res.json().catch(() => ({}));
    else if (opts.parse === 'blob') data = await res.blob();
    else data = await res.text();
    if (!res.ok) {
      const err = new Error((data && data.error) || res.statusText || 'Błąd API');
      err.status = res.status;
      err.body = data;
      throw err;
    }
    return data;
  }

  function normalizeRows(data) {
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.items)) return data.items;
    return [];
  }

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function renderRows(tbodyEl, rows, cols) {
    tbodyEl.innerHTML = '';
    rows.forEach((r) => {
      const tr = document.createElement('tr');
      tr.innerHTML = cols.map((c) => `<td>${esc(typeof c.fmt === 'function' ? c.fmt(r) : r[c.key])}</td>`).join('');
      tbodyEl.appendChild(tr);
    });
  }

  function renderTableOrEmpty(tbodyEl, rows, cols) {
    if (!rows.length) {
      tbodyEl.innerHTML = `<tr class="empty-row"><td colspan="${cols.length}" class="muted">Brak danych.</td></tr>`;
      return;
    }
    renderRows(tbodyEl, rows, cols);
  }

  function renderKeyValueTable(tbodyEl, obj) {
    tbodyEl.innerHTML = '';
    if (obj == null || typeof obj !== 'object' || Array.isArray(obj)) {
      tbodyEl.innerHTML = '<tr class="empty-row"><td colspan="2" class="muted">Brak ustawień.</td></tr>';
      return;
    }
    const keys = Object.keys(obj);
    if (!keys.length) {
      tbodyEl.innerHTML = '<tr class="empty-row"><td colspan="2" class="muted">Brak ustawień.</td></tr>';
      return;
    }
    keys.forEach((k) => {
      const v = obj[k];
      const val =
        v != null && typeof v === 'object' ? JSON.stringify(v, null, 2) : v == null ? '' : String(v);
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${esc(k)}</td><td><pre class="inline-kv">${esc(val)}</pre></td>`;
      tbodyEl.appendChild(tr);
    });
  }

  function showLogin() {
    $('#view-login').hidden = false;
    $('#view-app').hidden = true;
    $('#btn-logout').hidden = true;
    $('#user-bar').hidden = true;
  }

  function showApp() {
    $('#view-login').hidden = true;
    $('#view-app').hidden = false;
    $('#btn-logout').hidden = false;
    $('#user-bar').hidden = false;
    const u = state.user || {};
    $('#user-bar').textContent = `${u.imie || ''} ${u.nazwisko || ''} (${u.rola || '?'})`.trim();
    applyTelefonVisibility();
    applyNavVisibilityForRole();
    applyZleceniaCardsForRole();
    loadOddzialyDefault();
    let active = document.querySelector('.nav-item.active');
    if (!active || active.hidden || !canAccessPanel(active.dataset.panel)) {
      document.querySelectorAll('.nav-item').forEach((b) => b.classList.remove('active'));
      active = [...document.querySelectorAll('.nav-item[data-panel]')].find((b) => !b.hidden);
      if (active) active.classList.add('active');
    }
    showPanel(active?.dataset?.panel || 'panel-pulpit');
  }

  function applyTelefonVisibility() {
    const blocked = !canTelefon();
    $('#telefon-blocked').hidden = !blocked;
    $('#telefon-active').hidden = blocked;
    const team = isTeamRole();
    ['chk-dmuchawa', 'chk-rebak', 'chk-kaski', 'chk-bhp'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.closest('label').style.display = team ? '' : 'none';
    });
    $('#btn-gps').style.display = team ? '' : 'none';
    $('#gps-readout').textContent = team
      ? ''
      : 'Kierownictwo: checklista ukryta — możesz wysłać pusty POST (start bez GPS).';
  }

  function showPanel(panelId) {
    document.querySelectorAll('.nav-item').forEach((b) => {
      b.classList.toggle('active', b.dataset.panel === panelId && !b.hidden);
    });
    document.querySelectorAll('.app-content .panel').forEach((p) => {
      p.hidden = p.id !== panelId;
    });
  }

  function bindNav() {
    document.querySelectorAll('.nav-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.panel;
        if (!id || btn.hidden || !canAccessPanel(id)) return;
        document.querySelectorAll('.nav-item').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        showPanel(id);
      });
    });
  }

  function canConfirmGodzinyRow(r) {
    if (state.user?.rola !== 'Brygadzista') return false;
    if (r.status !== 'Oczekuje') return false;
    return Number(r.brygadzista_id) === Number(state.user.id);
  }

  function renderGodzinyTable(tbody, rows) {
    const colCount = 8;
    tbody.innerHTML = '';
    if (!rows.length) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="${colCount}" class="muted">Brak danych.</td></tr>`;
      return;
    }
    rows.forEach((r) => {
      const tr = document.createElement('tr');
      const osoby = [r.pomocnik_nazwa, r.brygadzista_nazwa].filter(Boolean).join(' · ') || '—';
      const act = canConfirmGodzinyRow(r)
        ? `<td class="nowrap"><button type="button" class="btn btn-sm" data-godz-act="Potwierdzone" data-id="${r.id}">Potwierdź</button> <button type="button" class="btn btn-sm ghost" data-godz-act="Odrzucone" data-id="${r.id}">Odrzuć</button></td>`
        : '<td class="muted">—</td>';
      tr.innerHTML = `<td>${esc(r.id)}</td><td>${esc(r.data_pracy != null ? String(r.data_pracy).slice(0, 10) : '')}</td><td>${esc(r.godziny)}</td><td>${esc(r.status)}</td><td>${esc(r.klient_nazwa || '')}</td><td>${esc(osoby)}</td>${act}`;
      tbody.appendChild(tr);
    });
  }

  async function onGodzinyActionClick(ev) {
    const btn = ev.target.closest('[data-godz-act]');
    if (!btn) return;
    const id = btn.dataset.id;
    const status = btn.dataset.godzAct;
    const ok =
      status === 'Potwierdzone'
        ? window.confirm('Potwierdzić zgłoszone godziny?')
        : window.confirm('Odrzucić to zgłoszenie godzin?');
    if (!ok) return;
    try {
      await api(`/godziny/${id}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status }),
      });
      if (state.godzinyLast.path) {
        await loadGodziny(state.godzinyLast.path, state.godzinyLast.label);
      }
    } catch (e) {
      alert(e.body?.error || e.message);
    }
  }

  async function loadOddzialyDefault() {
    try {
      const rows = await api('/oddzialy');
      const arr = Array.isArray(rows) ? rows : rows.items || [];
      const inp = document.querySelector('#form-pojazd input[name="oddzial_id"]');
      if (inp && !inp.value && arr[0]) inp.value = arr[0].id;
    } catch {
      /* ignore */
    }
  }

  async function refreshPulpit() {
    const out = $('#pulpit-status');
    try {
      const [h, r] = await Promise.all([api('/health'), api('/ready')]);
      out.textContent = JSON.stringify({ health: h, ready: r }, null, 2);
    } catch (e) {
      out.textContent = e.message || String(e);
    }
  }

  async function refreshDashboard() {
    const out = $('#dashboard-out');
    out.textContent = '...';
    try {
      const days = Number($('#dash-days').value || 14);
      const oddzial = $('#dash-oddzial').value.trim();
      const q = new URLSearchParams({ days: String(days) });
      if (oddzial) q.set('oddzial_id', oddzial);
      const data = await api(`/dashboard/summary?${q.toString()}`);
      out.textContent = JSON.stringify(data, null, 2);
    } catch (e) {
      out.textContent = e.body?.error || e.message;
    }
  }

  async function refreshAiTodayPlan() {
    const out = $('#ai-plan-out');
    out.textContent = '...';
    try {
      const horizon_days = Number($('#ai-plan-days').value || 3);
      const data = await api('/ai/today-plan', {
        method: 'POST',
        body: JSON.stringify({ horizon_days }),
      });
      out.textContent = JSON.stringify(data, null, 2);
    } catch (e) {
      out.textContent = e.body?.error || e.message;
    }
  }

  async function runDailyAutomation() {
    const out = $('#automation-out');
    out.textContent = '...';
    try {
      const data = await api('/automations/run-daily', { method: 'POST' });
      out.textContent = JSON.stringify(data, null, 2);
    } catch (e) {
      out.textContent = e.body?.error || e.message;
    }
  }

  const TASK_STATUS_API = ['Nowe', 'Zaplanowane', 'W_Realizacji', 'Zakonczone'];

  function toDatetimeLocalValue(v) {
    if (v == null || v === '') return '';
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return String(v).slice(0, 16);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function populateTaskEditForm(t) {
    const f = $('#form-task-edit');
    if (!f) return;
    f.klient_nazwa.value = t.klient_nazwa || '';
    f.klient_telefon.value = t.klient_telefon || '';
    f.adres.value = t.adres || '';
    f.miasto.value = t.miasto || '';
    f.typ_uslugi.value = t.typ_uslugi || '';
    f.priorytet.value = t.priorytet || '';
    f.data_planowana.value = toDatetimeLocalValue(t.data_planowana);
    f.czas_planowany_godziny.value =
      t.czas_planowany_godziny != null && t.czas_planowany_godziny !== ''
        ? String(t.czas_planowany_godziny)
        : '';
    f.wartosc_planowana.value =
      t.wartosc_planowana != null && t.wartosc_planowana !== '' ? String(t.wartosc_planowana) : '';
    f.wartosc_rzeczywista.value =
      t.wartosc_rzeczywista != null && t.wartosc_rzeczywista !== '' ? String(t.wartosc_rzeczywista) : '';
    f.opis.value = t.opis || '';
    f.notatki_wewnetrzne.value = t.notatki_wewnetrzne || '';
    f.notatki_klienta.value = t.notatki_klienta || '';
  }

  function renderTaskDetailSummary(t) {
    const tb = $('#tbody-task-detail');
    const escCell = (v) => esc(v == null || v === '' ? '—' : String(v));
    const trunc = (s, n) => {
      const x = s == null ? '' : String(s);
      return x.length > n ? `${x.slice(0, n)}…` : x;
    };
    const adres = [t.adres, t.miasto].filter(Boolean).join(', ');
    const rows = [
      ['ID', String(t.id)],
      ['Status', t.status],
      ['Klient', t.klient_nazwa],
      ['Telefon', t.klient_telefon],
      ['Adres', adres || null],
      ['Typ usługi', t.typ_uslugi],
      ['Data planowana', t.data_planowana],
      ['Wartość planowana (PLN)', t.wartosc_planowana],
      ['Wartość rzeczywista (PLN)', t.wartosc_rzeczywista],
      ['Opis / dodatkowa praca', trunc(t.opis, 240)],
      ['Ekipa', t.ekipa_nazwa],
      ['Oddział', t.oddzial_nazwa],
      ['Brygadzista (użytk.)', t.kierownik_nazwa],
      ['Notatki wewnętrzne', trunc(t.notatki_wewnetrzne, 200)],
      ['Notatki dla klienta', trunc(t.notatki_klienta, 200)],
    ];
    tb.innerHTML = rows.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${escCell(v)}</td></tr>`).join('');
  }

  function setTaskDetailError(text) {
    const el = $('#task-detail-err');
    el.textContent = text || '';
    el.hidden = !text;
    if (text) $('#task-detail-msg').hidden = true;
  }

  async function loadTaskDetailById(id) {
    const num = Number(id);
    if (!num || num < 1) {
      setTaskDetailError('Podaj poprawne ID zlecenia.');
      return;
    }
    setTaskDetailError('');
    $('#task-detail-msg').hidden = true;
    $('#task-detail-status-note').hidden = true;
    try {
      const t = await api(`/tasks/${num}`);
      $('#task-detail-id').value = String(num);
      const sel = $('#task-detail-status');
      if (TASK_STATUS_API.includes(t.status)) {
        sel.value = t.status;
      } else {
        sel.value = 'Nowe';
        const note = $('#task-detail-status-note');
        note.textContent = `Status w bazie: „${t.status}” — wybierz jeden z dozwolonych i zapisz.`;
        note.hidden = false;
      }
      renderTaskDetailSummary(t);
      populateTaskEditForm(t);
    } catch (e) {
      $('#tbody-task-detail').innerHTML = '';
      setTaskDetailError(e.body?.error || e.message);
    }
  }

  async function loadTasksAll() {
    const data = await api('/tasks/wszystkie?limit=80');
    const rows = normalizeRows(data);
    const tb = $('#tbody-tasks-all');
    tb.innerHTML = '';
    if (!rows.length) {
      tb.innerHTML = '<tr class="empty-row"><td colspan="6" class="muted">Brak danych.</td></tr>';
      return;
    }
    rows.forEach((r) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${esc(r.id)}</td><td>${esc(r.status)}</td><td>${esc(r.klient_nazwa)}</td><td>${esc(r.adres)}</td><td>${esc(r.data_planowana || '')}</td>
        <td class="nowrap"><button type="button" class="btn btn-sm" data-task-open="${r.id}">Szczegóły</button></td>`;
      tb.appendChild(tr);
    });
  }

  async function loadKlienci() {
    const data = await api('/klienci?limit=100');
    const rows = normalizeRows(data);
    renderRows($('#tbody-klienci'), rows, [
      { key: 'id' },
      { key: 'imie' },
      { key: 'nazwisko' },
      { key: 'firma' },
      { key: 'telefon' },
      { key: 'miasto' },
    ]);
  }

  async function loadWyceny() {
    const data = await api('/wyceny?limit=80');
    const rows = normalizeRows(data);
    renderRows($('#tbody-wyceny'), rows, [
      { key: 'id' },
      { key: 'status_akceptacji' },
      { key: 'wartosc_szacowana' },
      { key: 'created_at', fmt: (r) => r.created_at || '' },
    ]);
  }

  async function loadOgledziny() {
    const data = await api('/ogledziny?limit=80');
    const rows = normalizeRows(data);
    renderRows($('#tbody-ogledziny'), rows, [
      { key: 'id' },
      { key: 'status' },
      { key: 'adres' },
      { key: 'data_planowana', fmt: (r) => r.data_planowana || '' },
    ]);
  }

  async function loadOddzialy() {
    const data = await api('/oddzialy');
    const rows = normalizeRows(data);
    renderRows($('#tbody-oddzialy'), rows, [
      { key: 'id' },
      { key: 'nazwa' },
      { key: 'miasto' },
    ]);
  }

  async function loadEkipy() {
    const data = await api('/ekipy?limit=80');
    const rows = normalizeRows(data);
    renderRows($('#tbody-ekipy'), rows, [
      { key: 'id' },
      { key: 'nazwa' },
      { key: 'oddzial_nazwa' },
    ]);
  }

  async function loadUsers() {
    const data = await api('/uzytkownicy?limit=100');
    const rows = normalizeRows(data);
    renderRows($('#tbody-users'), rows, [
      { key: 'id' },
      { key: 'login' },
      { key: 'imie', fmt: (r) => `${r.imie || ''} ${r.nazwisko || ''}`.trim() },
      { key: 'rola' },
    ]);
  }

  async function loadRole() {
    const data = await api('/role?limit=100');
    const rows = normalizeRows(data);
    renderRows($('#tbody-role'), rows, [
      { key: 'id' },
      { key: 'nazwa' },
      { key: 'poziom' },
    ]);
  }

  async function loadGodziny(path, label) {
    state.godzinyLast.path = path;
    state.godzinyLast.label = label || '';
    const data = await api(path);
    const rows = normalizeRows(data);
    const hint = $('#godziny-hint');
    if (hint) {
      hint.textContent = rows.length
        ? `Wpisy: ${rows.length}${label ? ` — ${label}` : ''}`
        : `Brak wpisów${label ? ` (${label})` : ''}.`;
    }
    renderGodzinyTable($('#tbody-godziny'), rows);
  }

  async function loadRapCzas() {
    const oid = $('#rap-czas-oddzial').value.trim();
    const q = oid ? `?oddzial_id=${encodeURIComponent(oid)}&limit=100` : '?limit=100';
    const data = await api(`/raporty/czas-pracy${q}`);
    const rows = normalizeRows(data);
    renderTableOrEmpty($('#tbody-rap-czas'), rows, [
      { key: 'task_id' },
      { key: 'klient_nazwa' },
      { key: 'adres' },
      { key: 'status' },
      { key: 'czas_minuty' },
      { key: 'ekipa_nazwa', fmt: (r) => r.ekipa_nazwa || '' },
      { key: 'brygadzista', fmt: (r) => r.brygadzista || '' },
    ]);
  }

  async function loadRapDzienne() {
    const data = await api('/raporty-dzienne?limit=40');
    const rows = normalizeRows(data);
    const trunc = (s, n) => {
      const t = s == null ? '' : String(s);
      return t.length > n ? `${t.slice(0, n)}…` : t;
    };
    renderTableOrEmpty($('#tbody-rap-dzienne'), rows, [
      { key: 'id' },
      { key: 'data_raportu', fmt: (r) => (r.data_raportu != null ? String(r.data_raportu).slice(0, 10) : '') },
      { key: 'status' },
      { key: 'czas_pracy_minuty' },
      { key: 'pracownik_nazwa', fmt: (r) => r.pracownik_nazwa || '' },
      { key: 'oddzial_nazwa', fmt: (r) => r.oddzial_nazwa || '' },
      { key: 'opis_pracy', fmt: (r) => trunc(r.opis_pracy, 80) },
    ]);
  }

  async function loadNotif() {
    const data = await api('/notifications?limit=80');
    const rows = normalizeRows(data);
    const trunc = (s, n) => {
      const t = s == null ? '' : String(s);
      return t.length > n ? `${t.slice(0, n)}…` : t;
    };
    renderTableOrEmpty($('#tbody-notif'), rows, [
      { key: 'id' },
      {
        key: 'data_utworzenia',
        fmt: (r) => (r.data_utworzenia != null ? String(r.data_utworzenia).slice(0, 19) : ''),
      },
      { key: 'status' },
      { key: 'typ' },
      { key: 'tresc', fmt: (r) => trunc(r.tresc, 100) },
      { key: 'od_kogo', fmt: (r) => r.od_kogo || '' },
      { key: 'klient_nazwa', fmt: (r) => r.klient_nazwa || '' },
    ]);
  }

  async function loadSmsHistoria() {
    const data = await api('/sms/historia?limit=40');
    const rows = normalizeRows(data);
    const trunc = (s, n) => {
      const t = s == null ? '' : String(s);
      return t.length > n ? `${t.slice(0, n)}…` : t;
    };
    renderTableOrEmpty($('#tbody-sms-historia'), rows, [
      {
        key: 'created_at',
        fmt: (r) => (r.created_at != null ? String(r.created_at).slice(0, 19) : ''),
      },
      { key: 'telefon' },
      { key: 'status' },
      { key: 'tresc', fmt: (r) => trunc(r.tresc, 100) },
      { key: 'klient_nazwa', fmt: (r) => r.klient_nazwa || '' },
    ]);
  }

  async function loadKsSettings() {
    const data = await api('/ksiegowosc/ustawienia');
    renderKeyValueTable($('#tbody-ks-settings'), data);
  }

  async function loadKsFaktury() {
    const data = await api('/ksiegowosc/faktury?limit=50');
    const rows = normalizeRows(data);
    renderTableOrEmpty($('#tbody-ks-faktury'), rows, [
      { key: 'id' },
      { key: 'numer' },
      { key: 'klient_nazwa' },
      { key: 'brutto' },
      { key: 'status' },
      {
        key: 'data_wystawienia',
        fmt: (r) => (r.data_wystawienia != null ? String(r.data_wystawienia).slice(0, 10) : ''),
      },
      { key: 'oddzial_nazwa', fmt: (r) => r.oddzial_nazwa || '' },
    ]);
  }

  async function loadAudit() {
    const errEl = $('#audit-err');
    errEl.hidden = true;
    try {
      const data = await api('/audit?limit=60');
      const rows = normalizeRows(data);
      renderTableOrEmpty($('#tbody-audit'), rows, [
        { key: 'id' },
        {
          key: 'created_at',
          fmt: (r) => (r.created_at != null ? String(r.created_at).slice(0, 19) : ''),
        },
        { key: 'user_login', fmt: (r) => r.user_login || '' },
        { key: 'rola', fmt: (r) => r.rola || '' },
        { key: 'action' },
        { key: 'entity_type' },
        { key: 'entity_id', fmt: (r) => r.entity_id || '' },
      ]);
    } catch (e) {
      $('#tbody-audit').innerHTML = '';
      errEl.textContent = e.body?.error || e.message;
      errEl.hidden = false;
    }
  }

  async function openAuthedPdf(apiPath, filename) {
    const res = await fetch(`/api${apiPath}`, {
      headers: { Authorization: `Bearer ${state.token}` },
    });
    const blob = await res.blob();
    if (!res.ok) {
      let t = await blob.text();
      try {
        const j = JSON.parse(t);
        if (j && j.error) t = j.error;
      } catch {
        /* keep text */
      }
      throw new Error(t || res.statusText);
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  }

  /* --- Login --- */
  $('#form-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const login = fd.get('login');
    const haslo = fd.get('haslo');
    const err = $('#login-error');
    err.hidden = true;
    try {
      const data = await api('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ login, haslo }),
      });
      saveState(data.token, data.user);
      showApp();
    } catch (ex) {
      err.textContent = ex.body?.error || ex.message;
      err.hidden = false;
    }
  });

  $('#btn-logout').addEventListener('click', () => {
    saveState(null, null);
    showLogin();
  });

  $('#btn-pulpit-refresh').addEventListener('click', () => {
    refreshPulpit().catch((e) => alert(e.message));
  });
  $('#btn-dashboard-refresh').addEventListener('click', () => {
    refreshDashboard().catch((e) => alert(e.message));
  });
  $('#btn-ai-today-plan').addEventListener('click', () => {
    refreshAiTodayPlan().catch((e) => alert(e.message));
  });
  $('#btn-automation-run').addEventListener('click', () => {
    runDailyAutomation().catch((e) => alert(e.message));
  });

  $('#btn-tasks-stats').addEventListener('click', () => {
    api('/tasks/stats')
      .then((d) => {
        $('#tasks-stats-out').textContent = JSON.stringify(d, null, 2);
      })
      .catch((e) => alert(e.body?.error || e.message));
  });

  $('#btn-tasks-all').addEventListener('click', () => {
    loadTasksAll().catch((e) => alert(e.body?.error || e.message));
  });

  $('#tbody-tasks-all').addEventListener('click', (e) => {
    const b = e.target.closest('[data-task-open]');
    if (!b) return;
    const id = b.dataset.taskOpen;
    $('#task-detail-id').value = id;
    loadTaskDetailById(id).catch((err) => setTaskDetailError(err.body?.error || err.message));
  });

  $('#btn-task-detail-load').addEventListener('click', () => {
    const id = $('#task-detail-id').value;
    loadTaskDetailById(id).catch((err) => setTaskDetailError(err.body?.error || err.message));
  });

  $('#btn-task-detail-pdf').addEventListener('click', () => {
    const id = $('#task-detail-id').value;
    if (!id) return alert('Podaj ID zlecenia');
    openAuthedPdf(`/pdf/zlecenie/${id}`, `zlecenie-${id}.pdf`).catch((err) => alert(err.message));
  });

  $('#form-task-status').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = $('#task-detail-id').value;
    if (!id) return alert('Najpierw pobierz zlecenie.');
    const status = $('#task-detail-status').value;
    const msg = $('#task-detail-msg');
    msg.hidden = true;
    setTaskDetailError('');
    try {
      await api(`/tasks/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) });
      msg.textContent = 'Status zapisany.';
      msg.hidden = false;
      await loadTaskDetailById(id);
      const wsz = $('#card-zlecenia-wszystkie');
      if (wsz && !wsz.hidden) loadTasksAll().catch(() => {});
      loadMoje().catch(() => {});
    } catch (err) {
      setTaskDetailError(err.body?.error || err.message);
    }
  });

  $('#form-task-edit').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = $('#task-detail-id').value;
    if (!id) return alert('Najpierw pobierz zlecenie.');
    const f = e.target;
    const msg = $('#task-detail-msg');
    msg.hidden = true;
    setTaskDetailError('');
    const body = {
      klient_nazwa: f.klient_nazwa.value.trim(),
      klient_telefon: f.klient_telefon.value.trim() || null,
      adres: f.adres.value.trim(),
      miasto: f.miasto.value.trim(),
      typ_uslugi: f.typ_uslugi.value.trim() || null,
      priorytet: f.priorytet.value.trim() || null,
      data_planowana: f.data_planowana.value,
      notatki_wewnetrzne: f.notatki_wewnetrzne.value.trim() || null,
      opis: f.opis.value.trim() || null,
      notatki_klienta: f.notatki_klienta.value.trim() || null,
    };
    const wp = f.wartosc_planowana.value.trim();
    if (wp !== '') body.wartosc_planowana = Number(wp);
    else body.wartosc_planowana = null;
    const cz = f.czas_planowany_godziny.value.trim();
    if (cz !== '') body.czas_planowany_godziny = Number(cz);
    else body.czas_planowany_godziny = null;
    const wr = f.wartosc_rzeczywista.value.trim();
    if (wr !== '') body.wartosc_rzeczywista = Number(wr);
    try {
      await api(`/tasks/${id}`, { method: 'PUT', body: JSON.stringify(body) });
      msg.textContent = 'Dane zlecenia zapisane.';
      msg.hidden = false;
      await loadTaskDetailById(id);
      const wsz = $('#card-zlecenia-wszystkie');
      if (wsz && !wsz.hidden) loadTasksAll().catch(() => {});
      loadMoje().catch(() => {});
    } catch (err) {
      setTaskDetailError(err.body?.error || err.message);
    }
  });

  $('#form-task-nowe').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const body = {
      klient_nazwa: f.klient_nazwa.value.trim(),
      klient_telefon: f.klient_telefon.value.trim() || null,
      adres: f.adres.value.trim(),
      miasto: f.miasto.value.trim(),
      typ_uslugi: f.typ_uslugi.value.trim() || null,
      data_planowana: f.data_planowana.value,
      oddzial_id: f.oddzial_id.value ? Number(f.oddzial_id.value) : null,
      ekipa_id: f.ekipa_id.value ? Number(f.ekipa_id.value) : null,
    };
    const msg = $('#task-nowe-msg');
    msg.hidden = true;
    try {
      const r = await api('/tasks/nowe', { method: 'POST', body: JSON.stringify(body) });
      msg.textContent = `Utworzono zlecenie id=${r.id}`;
      msg.hidden = false;
      loadTasksAll().catch(() => {});
    } catch (ex) {
      alert(ex.body?.error || ex.message);
    }
  });

  $('#btn-moje').addEventListener('click', () => {
    loadMoje().catch((e) => alert(e.message));
  });

  async function loadMoje() {
    const data = await api(`/tasks/moje?data=${todayISO()}`);
    const ul = $('#list-moje');
    ul.innerHTML = '';
    (data || []).forEach((t) => {
      const li = document.createElement('li');
      li.textContent = `#${t.id} ${t.klient_nazwa || ''} — ${t.status || ''} (${t.adres || ''})`;
      li.addEventListener('click', () => {
        document.querySelector('#form-start input[name="task_id"]').value = t.id;
        document.querySelector('#form-zdjecie input[name="task_id_z"]').value = t.id;
        $('#task-detail-id').value = String(t.id);
        loadTaskDetailById(t.id).catch((err) => setTaskDetailError(err.body?.error || err.message));
      });
      ul.appendChild(li);
    });
  }

  function todayISO() {
    return new Date().toISOString().slice(0, 10);
  }

  function fillGps(latId, lngId, readoutId) {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error('Brak geolokalizacji w przeglądarce'));
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          $(latId).value = String(lat);
          $(lngId).value = String(lng);
          if (readoutId) $(readoutId).textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
          resolve();
        },
        (err) => reject(err),
        { enableHighAccuracy: true, timeout: 15000 }
      );
    });
  }

  $('#btn-gps').addEventListener('click', () => {
    fillGps('#in-lat', '#in-lng', '#gps-readout').catch((e) => alert(e.message));
  });
  $('#btn-gps-z').addEventListener('click', () => {
    fillGps('#z-lat', '#z-lng', null).catch((e) => alert(e.message));
  });

  $('#form-start').addEventListener('submit', async (e) => {
    e.preventDefault();
    const tid = e.target.task_id.value;
    const lat = $('#in-lat').value;
    const lng = $('#in-lng').value;
    const team = isTeamRole();
    const body = { lat: lat || null, lng: lng || null };
    if (team) {
      body.dmuchawa_filtr_ok = $('#chk-dmuchawa').checked;
      body.rebak_zatankowany = $('#chk-rebak').checked;
      body.kaski_zespol = $('#chk-kaski').checked;
      body.bhp_potwierdzone = $('#chk-bhp').checked;
    }
    const msg = $('#start-msg');
    msg.hidden = true;
    try {
      await api(`/tasks/${tid}/start`, { method: 'POST', body: JSON.stringify(body) });
      msg.textContent = 'Praca rozpoczęta.';
      msg.hidden = false;
    } catch (ex) {
      alert(ex.body?.error || ex.message);
    }
  });

  $('#form-zdjecie').addEventListener('submit', async (e) => {
    e.preventDefault();
    const tid = e.target.task_id_z.value;
    const fd = new FormData();
    const fileInput = e.target.zdjecie;
    if (!fileInput.files[0]) return alert('Wybierz plik');
    fd.append('zdjecie', fileInput.files[0]);
    fd.append('typ', e.target.typ.value || 'Przed');
    const zla = $('#z-lat').value;
    const zlo = $('#z-lng').value;
    if (zla) fd.append('lat', zla);
    if (zlo) fd.append('lng', zlo);
    const msg = $('#zdjecie-msg');
    msg.hidden = true;
    try {
      await api(`/tasks/${tid}/zdjecia`, { method: 'POST', body: fd });
      msg.textContent = 'Zdjęcie wysłane.';
      msg.hidden = false;
    } catch (ex) {
      alert(ex.body?.error || ex.message);
    }
  });

  /* --- Flota --- */
  async function loadKatalog() {
    const arkusz = $('#flt-arkusz').value;
    const q = $('#flt-q').value.trim();
    const params = new URLSearchParams();
    if (arkusz) params.set('arkusz', arkusz);
    if (q) params.set('q', q);
    const data = await api(`/flota/katalog-pojazdow?${params}`);
    const sel = $('#flt-arkusz');
    const existing = new Set(Array.from(sel.options).map((o) => o.value).filter(Boolean));
    (data.arkusze || []).forEach((a) => {
      if (!existing.has(a)) {
        const o = document.createElement('option');
        o.value = a;
        o.textContent = a;
        sel.appendChild(o);
        existing.add(a);
      }
    });
    const tb = $('#tbody-katalog');
    tb.innerHTML = '';
    (data.items || []).forEach((row) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td><button type="button" class="btn pick">Wybierz</button></td>
        <td>${esc(row.arkusz)}</td><td>${esc(row.marka)}</td><td>${esc(row.model)}</td>
        <td>${esc(row.nr_rejestracyjny)}</td><td>${esc(row.vin || '')}</td><td>${esc(row.notatki || '')}</td>`;
      tr.querySelector('.pick').addEventListener('click', () => {
        const f = $('#form-pojazd');
        f.marka.value = row.marka;
        f.model.value = row.model;
        f.nr_rejestracyjny.value = row.nr_rejestracyjny;
        f.typ.value = row.model !== '-' ? `${row.marka} ${row.model}`.trim() : row.marka;
      });
      tb.appendChild(tr);
    });
  }

  $('#btn-katalog-refresh').addEventListener('click', () => {
    loadKatalog().catch((e) => alert(e.message));
  });
  $('#flt-arkusz').addEventListener('change', () => loadKatalog().catch(() => {}));
  $('#flt-q').addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') loadKatalog().catch(() => {});
  });

  $('#form-pojazd').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const body = {
      marka: f.marka.value.trim(),
      model: f.model.value.trim(),
      nr_rejestracyjny: f.nr_rejestracyjny.value.trim(),
      rok_produkcji: f.rok_produkcji.value ? Number(f.rok_produkcji.value) : null,
      typ: f.typ.value.trim() || null,
      oddzial_id: f.oddzial_id.value ? Number(f.oddzial_id.value) : null,
    };
    const msg = $('#pojazd-msg');
    msg.hidden = true;
    try {
      const r = await api('/flota/pojazdy', { method: 'POST', body: JSON.stringify(body) });
      msg.textContent = `Zapisano pojazd id=${r.id}`;
      msg.hidden = false;
    } catch (ex) {
      alert(ex.body?.error || ex.message);
    }
  });

  /* --- Telefon --- */
  $('#form-polacz').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = { do: fd.get('do') };
    const tid = fd.get('task_id');
    if (tid) body.task_id = Number(tid);
    const msg = $('#polacz-msg');
    msg.hidden = true;
    try {
      const r = await api('/telefon/polacz-do-klienta', { method: 'POST', body: JSON.stringify(body) });
      msg.textContent = r.message || 'OK';
      msg.hidden = false;
    } catch (ex) {
      alert(ex.body?.error || ex.message);
    }
  });

  $('#btn-rozmowy').addEventListener('click', () => {
    loadRozmowy().catch((e) => alert(e.message));
  });

  async function loadRozmowy() {
    const data = await api('/telefon/rozmowy');
    const rows = Array.isArray(data) ? data : data.items || [];
    const tb = $('#tbody-rozmowy');
    tb.innerHTML = '';
    rows.forEach((r) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${r.id}</td><td>${esc(r.status)}</td><td>${esc(r.client_number || '')}</td><td>${esc(String(r.created_at || ''))}</td>
        <td><button type="button" class="btn open-r">Szczegóły</button></td>`;
      tr.querySelector('.open-r').addEventListener('click', () => openRozmowa(r.id));
      tb.appendChild(tr);
    });
  }

  async function openRozmowa(id) {
    const r = await api(`/telefon/rozmowy/${id}`);
    $('#rozmowa-detail').hidden = false;
    $('#rozmowa-id').textContent = id;
    $('#rozmowa-raport').textContent = r.raport || '—';
    $('#rozmowa-wsk').textContent = r.wskazowki_specjalisty || '—';
    $('#rozmowa-trans').textContent = r.transcript || '—';
    $('#audio-nagranie').hidden = true;
    $('#btn-nagranie').dataset.id = id;
  }

  $('#btn-nagranie').addEventListener('click', async () => {
    const id = $('#btn-nagranie').dataset.id;
    if (!id) return;
    const a = $('#audio-nagranie');
    a.hidden = true;
    try {
      const res = await fetch(`/api/telefon/rozmowy/${id}/nagranie`, {
        headers: { Authorization: `Bearer ${state.token}` },
      });
      if (res.redirected) {
        window.open(res.url, '_blank');
        return;
      }
      const blob = await res.blob();
      if (!res.ok) throw new Error('Brak nagrania');
      const url = URL.createObjectURL(blob);
      if (a.src && a.src.startsWith('blob:')) URL.revokeObjectURL(a.src);
      a.src = url;
      a.hidden = false;
      await a.play().catch(() => {});
    } catch (ex) {
      alert(ex.message || 'Nie udało się odtworzyć nagrania');
    }
  });

  $('#btn-klienci-refresh').addEventListener('click', () => {
    loadKlienci().catch((e) => alert(e.body?.error || e.message));
  });

  $('#form-klient-nowy').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const body = {
      imie: f.imie.value.trim() || null,
      nazwisko: f.nazwisko.value.trim() || null,
      firma: f.firma.value.trim() || null,
      telefon: f.telefon.value.trim() || null,
      email: f.email.value.trim() || null,
      miasto: f.miasto.value.trim() || null,
      adres: f.adres.value.trim() || null,
    };
    const msg = $('#klient-nowy-msg');
    msg.hidden = true;
    try {
      await api('/klienci', { method: 'POST', body: JSON.stringify(body) });
      msg.textContent = 'Klient zapisany.';
      msg.hidden = false;
      loadKlienci().catch(() => {});
    } catch (ex) {
      alert(ex.body?.error || ex.message);
    }
  });

  $('#btn-wyceny-refresh').addEventListener('click', () => {
    loadWyceny().catch((e) => alert(e.body?.error || e.message));
  });
  $('#btn-ogledziny-refresh').addEventListener('click', () => {
    loadOgledziny().catch((e) => alert(e.body?.error || e.message));
  });
  $('#btn-oddzialy-refresh').addEventListener('click', () => {
    loadOddzialy().catch((e) => alert(e.body?.error || e.message));
  });
  $('#btn-ekipy-refresh').addEventListener('click', () => {
    loadEkipy().catch((e) => alert(e.body?.error || e.message));
  });
  $('#btn-users-refresh').addEventListener('click', () => {
    loadUsers().catch((e) => alert(e.body?.error || e.message));
  });
  $('#btn-role-refresh').addEventListener('click', () => {
    loadRole().catch((e) => alert(e.body?.error || e.message));
  });

  $('#btn-godz-moje').addEventListener('click', () => {
    loadGodziny('/godziny/moje?limit=80', 'moje').catch((e) => alert(e.body?.error || e.message));
  });
  $('#btn-godz-pending').addEventListener('click', () => {
    loadGodziny('/godziny/do-potwierdzenia?limit=80', 'do potwierdzenia').catch((e) =>
      alert(e.body?.error || e.message)
    );
  });
  $('#btn-godz-all').addEventListener('click', () => {
    loadGodziny('/godziny/wszystkie?limit=80', 'wszystkie').catch((e) => alert(e.body?.error || e.message));
  });
  $('#btn-rap-czas').addEventListener('click', () => {
    loadRapCzas().catch((e) => alert(e.body?.error || e.message));
  });
  $('#btn-rap-dzienne').addEventListener('click', () => {
    loadRapDzienne().catch((e) => alert(e.body?.error || e.message));
  });

  $('#btn-notif-refresh').addEventListener('click', () => {
    loadNotif().catch((e) => alert(e.body?.error || e.message));
  });
  $('#btn-notif-readall').addEventListener('click', () => {
    api('/notifications/odczytaj-wszystkie', { method: 'PUT' })
      .then(() => loadNotif())
      .catch((e) => alert(e.body?.error || e.message));
  });

  $('#form-sms').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const body = {
      telefon: f.telefon.value.trim(),
      tresc: f.tresc.value.trim(),
      task_id: f.task_id.value ? Number(f.task_id.value) : null,
    };
    const msg = $('#sms-msg');
    msg.hidden = true;
    try {
      await api('/sms/wyslij', { method: 'POST', body: JSON.stringify(body) });
      msg.textContent = 'Wysłano (lub zapisano w historii).';
      msg.hidden = false;
    } catch (ex) {
      alert(ex.body?.error || ex.message);
    }
  });
  $('#btn-sms-historia').addEventListener('click', () => {
    loadSmsHistoria().catch((e) => alert(e.body?.error || e.message));
  });

  $('#form-ai').addEventListener('submit', async (e) => {
    e.preventDefault();
    const tresc = e.target.tresc.value.trim();
    const out = $('#ai-out');
    out.textContent = '…';
    try {
      const r = await api('/ai/chat', {
        method: 'POST',
        body: JSON.stringify({
          messages: [{ role: 'user', content: tresc }],
        }),
      });
      out.textContent = r.reply != null ? r.reply : JSON.stringify(r, null, 2);
    } catch (ex) {
      out.textContent = ex.body?.error || ex.message;
    }
  });

  $('#btn-pdf-zlecenie').addEventListener('click', () => {
    const id = $('#pdf-task-id').value;
    if (!id) return alert('Podaj ID zlecenia');
    openAuthedPdf(`/pdf/zlecenie/${id}`, `zlecenie-${id}.pdf`).catch((e) => alert(e.message));
  });
  $('#btn-pdf-faktura').addEventListener('click', () => {
    const id = $('#pdf-fv-id').value;
    if (!id) return alert('Podaj ID faktury');
    openAuthedPdf(`/pdf/faktura/${id}`, `faktura-${id}.pdf`).catch((e) => alert(e.message));
  });
  $('#btn-pdf-dzien').addEventListener('click', () => {
    const d = $('#pdf-dzien').value;
    if (!d) return alert('Wybierz datę');
    openAuthedPdf(`/pdf/raport/dzienny/${d}`, `raport-dzienny-${d}.pdf`).catch((e) => alert(e.message));
  });

  $('#btn-ks-settings').addEventListener('click', () => {
    loadKsSettings().catch((e) => alert(e.body?.error || e.message));
  });
  $('#btn-ks-faktury').addEventListener('click', () => {
    loadKsFaktury().catch((e) => alert(e.body?.error || e.message));
  });
  $('#btn-audit-refresh').addEventListener('click', () => {
    loadAudit().catch((e) => alert(e.message));
  });

  document.addEventListener('keydown', (ev) => {
    const targetTag = ev.target?.tagName;
    if (targetTag === 'INPUT' || targetTag === 'TEXTAREA' || targetTag === 'SELECT') return;
    if (ev.key.toLowerCase() === 'r' && !ev.ctrlKey && !ev.metaKey) {
      ev.preventDefault();
      refreshPulpit().catch(() => {});
      refreshDashboard().catch(() => {});
    }
    if (ev.key.toLowerCase() === 'd' && !ev.ctrlKey && !ev.metaKey) {
      ev.preventDefault();
      showPanel('panel-pulpit');
      document.querySelectorAll('.nav-item').forEach((b) => {
        b.classList.toggle('active', b.dataset.panel === 'panel-pulpit');
      });
    }
  });

  /* boot */
  loadState();
  bindNav();
  if (state.token && state.user) {
    showApp();
    loadKatalog().catch(() => {});
    refreshPulpit().catch(() => {});
    refreshDashboard().catch(() => {});
  } else {
    showLogin();
  }
})();
