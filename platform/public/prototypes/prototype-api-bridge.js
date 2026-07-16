(function () {
  const params = new URLSearchParams(window.location.search);
  // apiUrl: w produkcji ZAWSZE same-origin (nginx proxuje /api) — cudzy origin z ?api=
  // wysłałby Bearer token i hasła na obcy serwer (spreparowany link). Cross-origin
  // dopuszczamy tylko na hostach deweloperskich (localhost/127.0.0.1).
  const devHost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  const requestedApi = params.get('api') || window.ARBOR_API_URL || '';
  let apiUrl = devHost ? 'http://127.0.0.1:8790' : window.location.origin;
  if (requestedApi) {
    try {
      const requested = new URL(requestedApi, window.location.href);
      if (devHost || requested.origin === window.location.origin) apiUrl = requested.origin;
    } catch (err) { /* niepoprawny URL → zostaje bezpieczny default */ }
  }
  const defaultLogin = params.get('login') || window.ARBOR_LOGIN || 'kierownik';
  const defaultPassword = params.get('password') || params.get('pin') || window.ARBOR_PASSWORD || '';
  let portalToken = params.get('portalToken') || params.get('token') || window.ARBOR_PORTAL_TOKEN || '';
  const tokenKey = 'arbor.demo.token';
  const loginKey = 'arbor.demo.login';
  const loggedOutKey = 'arbor.demo.logged_out';

  function loggedOutError(message) {
    const err = new Error(message || 'Wylogowano. Wybierz konto.');
    err.code = 'LOGGED_OUT';
    return err;
  }

  async function request(path, init) {
    return requestOnce(path, init, true);
  }

  async function requestText(path, init) {
    return requestTextOnce(path, init, true);
  }

  // Auto-relogin po 401 działa tylko tam, gdzie może się udać (dev bez haseł albo jawnie
  // podane hasło). Gdy serwer wymaga hasła (produkcja), oznaczamy wylogowanie i rzucamy
  // LOGGED_OUT — prototyp pokaże ekran logowania zamiast młócić limiter prób.
  async function reloginOrLockout() {
    try {
      await login(defaultLogin);
    } catch (err) {
      if (err instanceof TypeError) throw err; // brak sieci/API — to nie problem autoryzacji
      localStorage.setItem(loggedOutKey, 'true');
      throw loggedOutError('Sesja wygasła. Zaloguj się ponownie.');
    }
  }

  async function requestOnce(path, init, retryAuth) {
    const headers = new Headers(init && init.headers);
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const token = localStorage.getItem(tokenKey);
    if (token) headers.set('Authorization', 'Bearer ' + token);
    if (portalToken && path.startsWith('/api/portal')) headers.set('x-arbor-portal-token', portalToken);
    const response = await fetch(apiUrl + path, { ...init, headers });
    if (response.status === 401 && retryAuth && path !== '/api/auth/login') {
      localStorage.removeItem(tokenKey);
      localStorage.removeItem(loginKey);
      if (localStorage.getItem(loggedOutKey) === 'true') throw loggedOutError();
      await reloginOrLockout();
      return requestOnce(path, init, false);
    }
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  }

  async function requestTextOnce(path, init, retryAuth) {
    const headers = new Headers(init && init.headers);
    const token = localStorage.getItem(tokenKey);
    if (token) headers.set('Authorization', 'Bearer ' + token);
    const response = await fetch(apiUrl + path, { ...init, headers });
    if (response.status === 401 && retryAuth && path !== '/api/auth/login') {
      localStorage.removeItem(tokenKey);
      localStorage.removeItem(loginKey);
      if (localStorage.getItem(loggedOutKey) === 'true') throw loggedOutError();
      await reloginOrLockout();
      return requestTextOnce(path, init, false);
    }
    if (!response.ok) throw new Error(await response.text());
    return response.text();
  }

  async function login(login, password) {
    const payload = { login: login || 'kierownik' };
    if (password) payload.password = password;
    else if (defaultPassword) payload.password = defaultPassword;
    const data = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    localStorage.setItem(tokenKey, data.token);
    localStorage.setItem(loginKey, login || defaultLogin);
    localStorage.removeItem(loggedOutKey);
    reconnectRealtime(data.token);
    return data.user;
  }

  // ---- Realtime: auto-odświeżanie danych w prototypach ----
  // Socket.IO (serwowany przez API pod /socket.io/socket.io.js) → zdarzenia `arbor.event`
  // z kanałów użytkownika wywołują zarejestrowane handlery (z debounce). Gdy WebSocket
  // niedostępny (stary proxy, brak skryptu) — fallback: polling co 60 s.
  const refreshHandlers = [];
  let refreshTimer = null;
  let realtimeSocket = null;
  let realtimeState = 'idle'; // idle | loading | connected | polling
  let pollingTimer = null;

  function emitRefresh(event) {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshHandlers.forEach((handler) => {
        try { handler(event); } catch (err) { console.warn('ArborBridge onRefresh handler', err); }
      });
    }, 800);
  }

  function startPollingFallback() {
    if (pollingTimer) return;
    realtimeState = 'polling';
    pollingTimer = setInterval(() => {
      if (localStorage.getItem(tokenKey)) emitRefresh({ event: 'poll' });
    }, 60000);
  }

  function connectRealtime() {
    if (!window.io) return startPollingFallback();
    const token = localStorage.getItem(tokenKey);
    if (!token) return;
    try {
      realtimeSocket = window.io(apiUrl, { auth: { token } });
      realtimeSocket.on('realtime.ready', (payload) => {
        realtimeState = 'connected';
        realtimeSocket.emit('subscribe', (payload && payload.allowedChannels) || []);
      });
      realtimeSocket.on('arbor.event', (event) => emitRefresh(event));
      realtimeSocket.on('connect_error', () => { if (realtimeState !== 'connected') startPollingFallback(); });
    } catch (err) {
      console.warn('ArborBridge realtime init failed', err);
      startPollingFallback();
    }
  }

  function ensureRealtime() {
    if (realtimeState !== 'idle') return;
    realtimeState = 'loading';
    const script = document.createElement('script');
    script.src = apiUrl + '/socket.io/socket.io.js';
    script.onload = () => connectRealtime();
    script.onerror = () => startPollingFallback();
    document.head.appendChild(script);
  }

  function reconnectRealtime(token) {
    if (!realtimeSocket) return;
    try {
      realtimeSocket.auth = { token };
      realtimeSocket.disconnect().connect();
    } catch (err) { console.warn('ArborBridge realtime reconnect', err); }
  }

  function onRefresh(handler) {
    if (typeof handler !== 'function') return;
    refreshHandlers.push(handler);
    ensureRealtime();
  }

  async function bootstrap() {
    if (localStorage.getItem(loggedOutKey) === 'true') {
      throw loggedOutError();
    }
    if (!localStorage.getItem(tokenKey)) await reloginOrLockout();
    const data = await request('/api/bootstrap');
    if (data.portal && data.portal.token) portalToken = data.portal.token;
    return data;
  }

  function logout() {
    localStorage.removeItem(tokenKey);
    localStorage.removeItem(loginKey);
    localStorage.setItem(loggedOutKey, 'true');
    try { realtimeSocket?.disconnect(); } catch (err) { /* socket mógł nie istnieć */ }
    return { ok: true };
  }

  window.ArborBridge = {
    apiUrl,
    defaultLogin,
    get portalToken() { return portalToken; },
    setPortalToken(token) { portalToken = token || ''; },
    login,
    logout,
    isLoggedOut() { return localStorage.getItem(loggedOutKey) === 'true'; },
    currentLogin() { return localStorage.getItem(loginKey) || ''; },
    onRefresh,
    bootstrap,
    getPortal() {
      return request('/api/portal');
    },
    updateOrderStatus(id, status) {
      return request('/api/orders/' + encodeURIComponent(id) + '/status', {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
    },
    getOrderPortalLink(id) {
      return request('/api/orders/' + encodeURIComponent(id) + '/portal-link');
    },
    revokeOrderPortalLink(id) {
      return request('/api/orders/' + encodeURIComponent(id) + '/portal-link/revoke', { method: 'POST', body: '{}' });
    },
    createOrder(payload) {
      return request('/api/orders', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },
    updateOrder(id, payload) {
      return request('/api/orders/' + encodeURIComponent(id), {
        method: 'PATCH',
        body: JSON.stringify(payload || {}),
      });
    },
    cancelOrder(id) {
      return request('/api/orders/' + encodeURIComponent(id), {
        method: 'DELETE',
      });
    },
    createClient(payload) {
      return request('/api/clients', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },
    updateClient(id, payload) {
      return request('/api/clients/' + encodeURIComponent(id), {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
    },
    createUser(payload) {
      return request('/api/users', {
        method: 'POST',
        body: JSON.stringify(payload || {}),
      });
    },
    updateUser(id, payload) {
      return request('/api/users/' + encodeURIComponent(id), {
        method: 'PATCH',
        body: JSON.stringify(payload || {}),
      });
    },
    deleteUser(id) {
      return request('/api/users/' + encodeURIComponent(id), {
        method: 'DELETE',
      });
    },
    listBranches(includeArchived) {
      return request('/api/branches' + (includeArchived ? '?includeArchived=true' : ''));
    },
    createBranch(payload) {
      return request('/api/branches', {
        method: 'POST',
        body: JSON.stringify(payload || {}),
      });
    },
    updateBranch(id, payload) {
      return request('/api/branches/' + encodeURIComponent(id), {
        method: 'PATCH',
        body: JSON.stringify(payload || {}),
      });
    },
    deleteBranch(id) {
      return request('/api/branches/' + encodeURIComponent(id), {
        method: 'DELETE',
      });
    },
    listBranchDelegations(includeArchived) {
      return request('/api/branch-delegations' + (includeArchived ? '?includeArchived=true' : ''));
    },
    createBranchDelegation(payload) {
      return request('/api/branch-delegations', {
        method: 'POST',
        body: JSON.stringify(payload || {}),
      });
    },
    updateBranchDelegation(id, payload) {
      return request('/api/branch-delegations/' + encodeURIComponent(id), {
        method: 'PATCH',
        body: JSON.stringify(payload || {}),
      });
    },
    deleteBranchDelegation(id) {
      return request('/api/branch-delegations/' + encodeURIComponent(id), {
        method: 'DELETE',
      });
    },
    getBilling() {
      return request('/api/billing');
    },
    updateBillingSubscription(payload) {
      return request('/api/billing/subscription', {
        method: 'PATCH',
        body: JSON.stringify(payload || {}),
      });
    },
    startBillingCheckout(payload) {
      return request('/api/billing/checkout', {
        method: 'POST',
        body: JSON.stringify(payload || {}),
      });
    },
    createCrew(payload) {
      return request('/api/crews', {
        method: 'POST',
        body: JSON.stringify(payload || {}),
      });
    },
    updateCrew(id, payload) {
      return request('/api/crews/' + encodeURIComponent(id), {
        method: 'PATCH',
        body: JSON.stringify(payload || {}),
      });
    },
    deleteCrew(id) {
      return request('/api/crews/' + encodeURIComponent(id), {
        method: 'DELETE',
      });
    },
    listTreeAssets(params) {
      const query = new URLSearchParams();
      Object.entries(params || {}).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') query.set(key, value);
      });
      const suffix = query.toString() ? '?' + query.toString() : '';
      return request('/api/tree-assets' + suffix);
    },
    createTreeAsset(payload) {
      return request('/api/tree-assets', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },
    updateTreeAsset(id, payload) {
      return request('/api/tree-assets/' + encodeURIComponent(id), {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
    },
    deleteTreeAsset(id) {
      return request('/api/tree-assets/' + encodeURIComponent(id), {
        method: 'DELETE',
      });
    },
    listModuleConfigs() {
      return request('/api/module-configs');
    },
    createModuleConfig(payload) {
      return request('/api/module-configs', {
        method: 'POST',
        body: JSON.stringify(payload || {}),
      });
    },
    updateModuleConfig(id, payload) {
      return request('/api/module-configs/' + encodeURIComponent(id), {
        method: 'PATCH',
        body: JSON.stringify(payload || {}),
      });
    },
    deleteModuleConfig(id) {
      return request('/api/module-configs/' + encodeURIComponent(id), {
        method: 'DELETE',
      });
    },
    getIntegrationSettings() {
      return request('/api/integrations/settings');
    },
    updateIntegrationSettings(payload) {
      return request('/api/integrations/settings', {
        method: 'PATCH',
        body: JSON.stringify(payload || {}),
      });
    },
    getIntegrationHealth() {
      return request('/api/integrations/health');
    },
    getIntegrationSkills() {
      return request('/api/integrations/skills');
    },
    getIntegrationSetupReport() {
      return request('/api/integrations/setup-report');
    },
    getIntegrationSetupReportMarkdown() {
      return requestText('/api/integrations/setup-report?format=markdown');
    },
    runIntegrationLivePreflight(payload) {
      return request('/api/integrations/live-preflight', {
        method: 'POST',
        body: JSON.stringify(payload || {}),
      });
    },
    testIntegrations(payload) {
      return request('/api/integrations/test', {
        method: 'POST',
        body: JSON.stringify(payload || {}),
      });
    },
    testIntegrationChannel(channel) {
      return request('/api/integrations/test-channel', {
        method: 'POST',
        body: JSON.stringify({ channel }),
      });
    },
    createIntegrationSetupTasks() {
      return request('/api/integrations/setup-tasks', {
        method: 'POST',
        body: JSON.stringify({}),
      });
    },
    listJobPositions() {
      return request('/api/job-positions');
    },
    createJobPosition(payload) {
      return request('/api/job-positions', {
        method: 'POST',
        body: JSON.stringify(payload || {}),
      });
    },
    updateJobPosition(id, payload) {
      return request('/api/job-positions/' + encodeURIComponent(id), {
        method: 'PATCH',
        body: JSON.stringify(payload || {}),
      });
    },
    deleteJobPosition(id) {
      return request('/api/job-positions/' + encodeURIComponent(id), {
        method: 'DELETE',
      });
    },
    listEmployeeContracts() {
      return request('/api/hr/contracts');
    },
    createEmployeeContract(payload) {
      return request('/api/hr/contracts', {
        method: 'POST',
        body: JSON.stringify(payload || {}),
      });
    },
    updateEmployeeContract(id, payload) {
      return request('/api/hr/contracts/' + encodeURIComponent(id), {
        method: 'PATCH',
        body: JSON.stringify(payload || {}),
      });
    },
    deleteEmployeeContract(id) {
      return request('/api/hr/contracts/' + encodeURIComponent(id), {
        method: 'DELETE',
      });
    },
    getHrCompliance(days) {
      return request('/api/hr/compliance' + (days ? '?days=' + encodeURIComponent(days) : ''));
    },
    listDocumentTemplates() {
      return request('/api/document-templates');
    },
    createDocumentTemplate(payload) {
      return request('/api/document-templates', {
        method: 'POST',
        body: JSON.stringify(payload || {}),
      });
    },
    updateDocumentTemplate(id, payload) {
      return request('/api/document-templates/' + encodeURIComponent(id), {
        method: 'PATCH',
        body: JSON.stringify(payload || {}),
      });
    },
    deleteDocumentTemplate(id) {
      return request('/api/document-templates/' + encodeURIComponent(id), {
        method: 'DELETE',
      });
    },
    previewDocumentTemplate(id, payload) {
      return request('/api/document-templates/' + encodeURIComponent(id) + '/preview', {
        method: 'POST',
        body: JSON.stringify(payload || {}),
      });
    },
    generateDocument(payload) {
      return request('/api/documents/generate', {
        method: 'POST',
        body: JSON.stringify(payload || {}),
      });
    },
    attachDocument(payload) {
      return request('/api/documents/attach', {
        method: 'POST',
        body: JSON.stringify(payload || {}),
      });
    },
    signGeneratedDocument(id, payload) {
      return request('/api/generated-documents/' + encodeURIComponent(id) + '/sign', {
        method: 'POST',
        body: JSON.stringify(payload || {}),
      });
    },
    getDocumentCompliance(subjectType, subjectId) {
      return request('/api/documents/compliance?subjectType=' + encodeURIComponent(subjectType) + '&subjectId=' + encodeURIComponent(subjectId));
    },
    listDocumentRequirements() {
      return request('/api/document-requirements');
    },
    createDocumentRequirement(payload) {
      return request('/api/document-requirements', {
        method: 'POST',
        body: JSON.stringify(payload || {}),
      });
    },
    updateDocumentRequirement(id, payload) {
      return request('/api/document-requirements/' + encodeURIComponent(id), {
        method: 'PATCH',
        body: JSON.stringify(payload || {}),
      });
    },
    deleteDocumentRequirement(id) {
      return request('/api/document-requirements/' + encodeURIComponent(id), {
        method: 'DELETE',
      });
    },
    fulfillDocumentRequirement(id, payload) {
      return request('/api/document-requirements/' + encodeURIComponent(id) + '/fulfill', {
        method: 'POST',
        body: JSON.stringify(payload || {}),
      });
    },
    exportClientsCsv() {
      return requestText('/api/clients/export.csv');
    },
    importClientsCsv(csv) {
      return request('/api/clients/import.csv', {
        method: 'POST',
        headers: { 'Content-Type': 'text/csv' },
        body: csv,
      });
    },
    createValuation(payload) {
      return request('/api/valuations', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },
    updateValuation(id, status) {
      return request('/api/valuations/' + encodeURIComponent(id) + '/status', {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
    },
    createMobileMeetingRecording(payload) {
      return request('/api/mobile/meeting-recordings', {
        method: 'POST',
        body: JSON.stringify(payload || {}),
      });
    },
    simulateFieldMeeting(payload) {
      return request('/api/field-meetings/simulate', {
        method: 'POST',
        body: JSON.stringify(payload || {}),
      });
    },
    assignTeam(orderId, teamId) {
      return request('/api/orders/' + encodeURIComponent(orderId) + '/assign-team', {
        method: 'POST',
        body: JSON.stringify({ teamId }),
      });
    },
    createInvoice(payload) {
      return request('/api/invoices', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },
    updateInvoiceStatus(id, status) {
      return request('/api/invoices/' + encodeURIComponent(id) + '/status', {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
    },
    runCallAnalysis(recordingId, payload) {
      return request('/api/call-analyses/' + encodeURIComponent(recordingId) + '/run', {
        method: 'POST',
        body: JSON.stringify(payload || {}),
      });
    },
    listCommunications() {
      return request('/api/communications');
    },
    createCommunication(payload) {
      return request('/api/communications', {
        method: 'POST',
        body: JSON.stringify(payload || {}),
      });
    },
    updateCommunication(id, payload) {
      return request('/api/communications/' + encodeURIComponent(id), {
        method: 'PATCH',
        body: JSON.stringify(payload || {}),
      });
    },
    deleteCommunication(id) {
      return request('/api/communications/' + encodeURIComponent(id), {
        method: 'DELETE',
      });
    },
    analyzeCommunication(id, payload) {
      return request('/api/communications/' + encodeURIComponent(id) + '/analyze', {
        method: 'POST',
        body: JSON.stringify(payload || {}),
      });
    },
    attachCommunicationRecording(id, payload) {
      return request('/api/communications/' + encodeURIComponent(id) + '/recording', {
        method: 'POST',
        body: JSON.stringify(payload || {}),
      });
    },
    startZadarmaCall(payload) {
      return request('/api/zadarma/call', {
        method: 'POST',
        body: JSON.stringify(payload || {}),
      });
    },
    createIncomingSoftphoneCall(payload) {
      return request('/api/softphone/incoming', {
        method: 'POST',
        body: JSON.stringify(payload || {}),
      });
    },
    answerSoftphoneCall(id, payload) {
      return request('/api/softphone/' + encodeURIComponent(id) + '/answer', {
        method: 'POST',
        body: JSON.stringify(payload || {}),
      });
    },
    completeSoftphoneCall(id, payload) {
      return request('/api/softphone/' + encodeURIComponent(id) + '/complete', {
        method: 'POST',
        body: JSON.stringify(payload || {}),
      });
    },
    getSoftphoneAvailability(branchId) {
      return request('/api/softphone/availability' + (branchId ? '?branchId=' + encodeURIComponent(branchId) : ''));
    },
    updateSoftphoneAvailability(payload) {
      return request('/api/softphone/availability', {
        method: 'PATCH',
        body: JSON.stringify(payload || {}),
      });
    },
    updateAiReceptionistSettings(payload) {
      return request('/api/ai-receptionist/settings', {
        method: 'PATCH',
        body: JSON.stringify(payload || {}),
      });
    },
    simulateAiReceptionist(payload) {
      return request('/api/ai-receptionist/simulate', {
        method: 'POST',
        body: JSON.stringify(payload || {}),
      });
    },
    listAiPrompts() {
      return request('/api/ai-prompts');
    },
    createAiPrompt(payload) {
      return request('/api/ai-prompts', {
        method: 'POST',
        body: JSON.stringify(payload || {}),
      });
    },
    updateAiPrompt(id, payload) {
      return request('/api/ai-prompts/' + encodeURIComponent(id), {
        method: 'PATCH',
        body: JSON.stringify(payload || {}),
      });
    },
    deleteAiPrompt(id) {
      return request('/api/ai-prompts/' + encodeURIComponent(id), {
        method: 'DELETE',
      });
    },
    listAiPromptVersions(id) {
      return request('/api/ai-prompts/' + encodeURIComponent(id) + '/versions');
    },
    testAiPrompt(id, payload) {
      return request('/api/ai-prompts/' + encodeURIComponent(id) + '/test', {
        method: 'POST',
        body: JSON.stringify(payload || {}),
      });
    },
    rollbackAiPrompt(id, version) {
      return request('/api/ai-prompts/' + encodeURIComponent(id) + '/rollback', {
        method: 'POST',
        body: JSON.stringify({ version }),
      });
    },
    listWorkflows() {
      return request('/api/workflows');
    },
    listWorkflowRuns(workflowId) {
      return request('/api/workflow-runs' + (workflowId ? '?workflowId=' + encodeURIComponent(workflowId) : ''));
    },
    createWorkflow(payload) {
      return request('/api/workflows', {
        method: 'POST',
        body: JSON.stringify(payload || {}),
      });
    },
    updateWorkflow(id, payload) {
      return request('/api/workflows/' + encodeURIComponent(id), {
        method: 'PATCH',
        body: JSON.stringify(payload || {}),
      });
    },
    deleteWorkflow(id) {
      return request('/api/workflows/' + encodeURIComponent(id), {
        method: 'DELETE',
      });
    },
    toggleWorkflow(id) {
      return request('/api/workflows/' + encodeURIComponent(id) + '/toggle', {
        method: 'POST',
        body: JSON.stringify({}),
      });
    },
    testWorkflow(id, payload) {
      return request('/api/workflows/' + encodeURIComponent(id) + '/test', {
        method: 'POST',
        body: JSON.stringify(payload || {}),
      });
    },
    toggleWorkflowKillSwitch(id) {
      return request('/api/workflows/' + encodeURIComponent(id) + '/kill-switch', {
        method: 'POST',
        body: JSON.stringify({}),
      });
    },
    approveWorkflowRun(id, payload) {
      return request('/api/workflow-runs/' + encodeURIComponent(id) + '/approve', {
        method: 'POST',
        body: JSON.stringify(payload || {}),
      });
    },
    rejectWorkflowRun(id, payload) {
      return request('/api/workflow-runs/' + encodeURIComponent(id) + '/reject', {
        method: 'POST',
        body: JSON.stringify(payload || {}),
      });
    },
    rollbackWorkflowRun(id, payload) {
      return request('/api/workflow-runs/' + encodeURIComponent(id) + '/rollback', {
        method: 'POST',
        body: JSON.stringify(payload || {}),
      });
    },
    processDueWorkflowRuns(payload) {
      return request('/api/workflow-runs/process-due', {
        method: 'POST',
        body: JSON.stringify(payload || {}),
      });
    },
    executeWorkflows(payload) {
      return request('/api/workflows/execute', {
        method: 'POST',
        body: JSON.stringify(payload || {}),
      });
    },
    getRecording(callId) {
      return request('/api/zadarma/recordings/' + encodeURIComponent(callId));
    },
    createRequest(payload) {
      return request('/api/requests', {
        method: 'POST',
        body: JSON.stringify(payload || {}),
      });
    },
    createEquipment(payload) {
      return request('/api/equipment', {
        method: 'POST',
        body: JSON.stringify(payload || {}),
      });
    },
    updateEquipment(id, payload) {
      return request('/api/equipment/' + encodeURIComponent(id), {
        method: 'PATCH',
        body: JSON.stringify(payload || {}),
      });
    },
    deleteEquipment(id) {
      return request('/api/equipment/' + encodeURIComponent(id), {
        method: 'DELETE',
      });
    },
    reserveEquipment(equipmentId, payload) {
      return request('/api/equipment/' + encodeURIComponent(equipmentId) + '/reservations', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },
    updateEquipmentReservation(id, payload) {
      return request('/api/equipment-reservations/' + encodeURIComponent(id), {
        method: 'PATCH',
        body: JSON.stringify(payload || {}),
      });
    },
    cancelEquipmentReservation(id) {
      return request('/api/equipment-reservations/' + encodeURIComponent(id), {
        method: 'DELETE',
      });
    },
    getWarehouse() {
      return request('/api/warehouse');
    },
    createWarehouseItem(payload) {
      return request('/api/warehouse/items', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },
    updateWarehouseItem(id, payload) {
      return request('/api/warehouse/items/' + encodeURIComponent(id), {
        method: 'PATCH',
        body: JSON.stringify(payload || {}),
      });
    },
    deleteWarehouseItem(id) {
      return request('/api/warehouse/items/' + encodeURIComponent(id), {
        method: 'DELETE',
      });
    },
    createWarehouseMovement(payload) {
      return request('/api/warehouse/movements', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },
    createPurchaseOrder(payload) {
      return request('/api/warehouse/orders', {
        method: 'POST',
        body: JSON.stringify(payload || {}),
      });
    },
    updatePurchaseOrderStatus(id, status) {
      return request('/api/warehouse/orders/' + encodeURIComponent(id) + '/status', {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
    },
    getReportsOverview() {
      return request('/api/reports/overview');
    },
    patchPortal(payload) {
      return request('/api/portal', {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
    },
    addPortalMessage(message) {
      return request('/api/portal/message', {
        method: 'POST',
        body: JSON.stringify({ message }),
      });
    },
  };
})();
