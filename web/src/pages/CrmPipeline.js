import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Sidebar from '../components/Sidebar';
import PageHeader from '../components/PageHeader';
import StatusMessage from '../components/StatusMessage';
import api from '../api';
import { getStoredToken, authHeaders } from '../utils/storedToken';
import { getApiErrorMessage } from '../utils/apiError';
import { readStoredUser } from '../utils/readStoredUser';
import {
  CRM_CLOSE_REASONS,
  CRM_LEAD_STAGES,
  isClosedLeadStage,
  isTechnicalCloseReason,
  stageForCloseReason,
} from '../utils/crmLeadClosure';

const STAGES = CRM_LEAD_STAGES;

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

const EMPTY_MESSAGE = {
  channel: 'whatsapp',
  direction: 'inbound',
  template_id: '',
  sender_handle: '',
  recipient_handle: '',
  subject: '',
  body: '',
};

const EMPTY_TEMPLATE = {
  name: '',
  key: '',
  channel: 'sms',
  subject: '',
  body: '',
};

const EMPTY_NPS = {
  score: '10',
  channel: 'phone',
  comment: '',
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
  const [closeDialog, setCloseDialog] = useState(null);
  const [activities, setActivities] = useState([]);
  const [activitiesLoading, setActivitiesLoading] = useState(false);
  const [activityForm, setActivityForm] = useState(EMPTY_ACTIVITY);
  const [savingActivity, setSavingActivity] = useState(false);
  const [workflowEvents, setWorkflowEvents] = useState([]);
  const [workflowEventsLoading, setWorkflowEventsLoading] = useState(false);
  const [npsSurveys, setNpsSurveys] = useState([]);
  const [npsLoading, setNpsLoading] = useState(false);
  const [npsForm, setNpsForm] = useState(EMPTY_NPS);
  const [savingNps, setSavingNps] = useState(false);
  const [messages, setMessages] = useState([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messageTemplates, setMessageTemplates] = useState([]);
  const [templateForm, setTemplateForm] = useState(EMPTY_TEMPLATE);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [messageForm, setMessageForm] = useState(EMPTY_MESSAGE);
  const [savingMessage, setSavingMessage] = useState(false);
  const [aiLead, setAiLead] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [workflows, setWorkflows] = useState([]);
  const [workflowsLoading, setWorkflowsLoading] = useState(false);
  const [savingWorkflow, setSavingWorkflow] = useState(false);

  const currentUser = useMemo(() => readStoredUser(), []);
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

  const workflowOddzialId = useMemo(
    () => filter.oddzial_id || form.oddzial_id || (currentUser?.oddzial_id ? String(currentUser.oddzial_id) : '') || (oddzialy[0]?.id ? String(oddzialy[0].id) : ''),
    [currentUser?.oddzial_id, filter.oddzial_id, form.oddzial_id, oddzialy]
  );

  const loadWorkflows = useCallback(async () => {
    if (!workflowOddzialId) {
      setWorkflows([]);
      return;
    }
    try {
      setWorkflowsLoading(true);
      const res = await api.get('/crm/workflows', { headers: requestHeaders, params: { oddzial_id: workflowOddzialId } });
      setWorkflows(Array.isArray(res.data) ? res.data : []);
    } catch {
      setWorkflows([]);
    } finally {
      setWorkflowsLoading(false);
    }
  }, [requestHeaders, workflowOddzialId]);

  useEffect(() => {
    loadWorkflows();
  }, [loadWorkflows]);

  useEffect(() => {
    const defaultBranchId = currentUser?.oddzial_id
      ? String(currentUser.oddzial_id)
      : (oddzialy.length === 1 ? String(oddzialy[0]?.id || '') : '');
    const defaultOwnerId = currentUser?.id ? String(currentUser.id) : '';
    if (!defaultBranchId && !defaultOwnerId) return;
    setForm((prev) => {
      if (prev.oddzial_id || prev.owner_user_id) return prev;
      return {
        ...prev,
        oddzial_id: defaultBranchId || prev.oddzial_id,
        owner_user_id: defaultOwnerId || prev.owner_user_id,
      };
    });
  }, [currentUser?.id, currentUser?.oddzial_id, oddzialy]);

  const selectedLead = useMemo(
    () => (selectedLeadId ? leads.find((l) => Number(l.id) === Number(selectedLeadId)) : null),
    [leads, selectedLeadId]
  );
  const roundRobinOwners = useMemo(() => {
    const branchId = Number(workflowOddzialId || 0);
    return owners
      .filter((owner) => !branchId || !owner.oddzial_id || Number(owner.oddzial_id) === branchId)
      .filter((owner) => Number(owner.id) > 0);
  }, [owners, workflowOddzialId]);
  const closingLead = useMemo(
    () => (closeDialog?.leadId ? leads.find((l) => Number(l.id) === Number(closeDialog.leadId)) : null),
    [closeDialog?.leadId, leads]
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

  const loadMessages = useCallback(
    async (leadId) => {
      if (!leadId) {
        setMessages([]);
        return;
      }
      try {
        setMessagesLoading(true);
        const res = await api.get(`/crm/leads/${leadId}/messages`, { headers: requestHeaders });
        setMessages(Array.isArray(res.data) ? res.data : []);
      } catch (e) {
        setMsg(getApiErrorMessage(e, t('crm.pipeline.errors.messagesLoad', { defaultValue: 'Nie udało się pobrać rozmów leada.' })));
        setMessages([]);
      } finally {
        setMessagesLoading(false);
      }
    },
    [requestHeaders, t]
  );

  const loadWorkflowEvents = useCallback(
    async (leadId) => {
      if (!leadId) {
        setWorkflowEvents([]);
        return;
      }
      try {
        setWorkflowEventsLoading(true);
        const res = await api.get(`/crm/leads/${leadId}/workflow-events`, { headers: requestHeaders });
        setWorkflowEvents(Array.isArray(res.data) ? res.data : []);
      } catch {
        setWorkflowEvents([]);
      } finally {
        setWorkflowEventsLoading(false);
      }
    },
    [requestHeaders]
  );

  const loadNpsSurveys = useCallback(
    async (leadId) => {
      if (!leadId) {
        setNpsSurveys([]);
        return;
      }
      try {
        setNpsLoading(true);
        const res = await api.get(`/crm/leads/${leadId}/nps-surveys`, { headers: requestHeaders });
        setNpsSurveys(Array.isArray(res.data) ? res.data : []);
      } catch {
        setNpsSurveys([]);
      } finally {
        setNpsLoading(false);
      }
    },
    [requestHeaders]
  );

  const loadMessageTemplates = useCallback(async () => {
    try {
      const params = {};
      if (workflowOddzialId) params.oddzial_id = workflowOddzialId;
      const res = await api.get('/crm/message-templates', { headers: requestHeaders, params });
      setMessageTemplates(Array.isArray(res.data) ? res.data : []);
    } catch {
      setMessageTemplates([]);
    }
  }, [requestHeaders, workflowOddzialId]);

  useEffect(() => {
    loadMessageTemplates();
  }, [loadMessageTemplates]);

  useEffect(() => {
    if (selectedLeadId) {
      loadActivities(selectedLeadId);
      loadMessages(selectedLeadId);
      loadWorkflowEvents(selectedLeadId);
      loadNpsSurveys(selectedLeadId);
    } else {
      setActivities([]);
      setMessages([]);
      setWorkflowEvents([]);
      setNpsSurveys([]);
      setAiLead(null);
    }
  }, [selectedLeadId, loadActivities, loadMessages, loadWorkflowEvents, loadNpsSurveys]);

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
      const res = await api.patch(`/crm/leads/${leadId}`, patch, { headers: requestHeaders });
      setLeads((prev) => prev.map((lead) => (Number(lead.id) === Number(leadId) ? { ...lead, ...(res.data || patch) } : lead)));
    } catch (e) {
      setMsg(getApiErrorMessage(e, t('crm.pipeline.errors.update', { defaultValue: 'Nie udało się zaktualizować leada.' })));
      await loadData();
    }
  };

  const requestStageChange = async (leadId, stage) => {
    if (!leadId || !stage) return;
    if (isClosedLeadStage(stage)) {
      setCloseDialog({ leadId, requestedStage: stage, reason: '' });
      return;
    }
    await patchLead(leadId, { stage, close_reason: null });
  };

  const submitCloseLead = async () => {
    if (!closeDialog?.leadId) return;
    const reason = String(closeDialog.reason || '').trim();
    if (!reason) {
      setMsg(t('crm.pipeline.closeReasonRequired', { defaultValue: 'Wybierz powód zamknięcia leada.' }));
      return;
    }
    await patchLead(closeDialog.leadId, { stage: stageForCloseReason(reason), close_reason: reason });
    setCloseDialog(null);
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

  const submitMessage = async () => {
    if (!selectedLeadId || (!messageForm.body.trim() && !messageForm.template_id)) return;
    try {
      setSavingMessage(true);
      await api.post(
        `/crm/leads/${selectedLeadId}/messages`,
        {
          ...messageForm,
          body: messageForm.body.trim(),
          template_id: messageForm.template_id ? Number(messageForm.template_id) : undefined,
          sender_handle: messageForm.sender_handle.trim() || null,
          recipient_handle: messageForm.recipient_handle.trim() || null,
          subject: messageForm.subject.trim() || null,
        },
        { headers: requestHeaders }
      );
      setMessageForm((prev) => ({ ...EMPTY_MESSAGE, channel: prev.channel, direction: prev.direction }));
      await loadMessages(selectedLeadId);
      await loadData();
    } catch (e) {
      setMsg(getApiErrorMessage(e, t('crm.pipeline.errors.messagesAdd', { defaultValue: 'Nie udało się zapisać wiadomości.' })));
    } finally {
      setSavingMessage(false);
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

  const submitNps = async () => {
    if (!selectedLeadId) return;
    const score = Number(npsForm.score);
    if (!Number.isInteger(score) || score < 0 || score > 10) {
      setMsg(t('crm.pipeline.nps.scoreError', { defaultValue: 'NPS musi być liczbą od 0 do 10.' }));
      return;
    }
    try {
      setSavingNps(true);
      await api.post(
        `/crm/leads/${selectedLeadId}/nps-surveys`,
        {
          score,
          channel: npsForm.channel,
          comment: npsForm.comment.trim() || null,
        },
        { headers: requestHeaders }
      );
      setNpsForm(EMPTY_NPS);
      await Promise.all([loadNpsSurveys(selectedLeadId), loadData()]);
    } catch (e) {
      setMsg(getApiErrorMessage(e, t('crm.pipeline.nps.createError', { defaultValue: 'Nie udało się zapisać NPS.' })));
    } finally {
      setSavingNps(false);
    }
  };

  const runLeadAi = async () => {
    if (!selectedLeadId) return;
    try {
      setAiLoading(true);
      setMsg('');
      const res = await api.post(`/crm/leads/${selectedLeadId}/ai-assistant`, {}, { headers: requestHeaders });
      setAiLead(res.data || null);
    } catch (e) {
      setMsg(getApiErrorMessage(e, t('crm.pipeline.ai.error', { defaultValue: 'AI CRM nie udało się uruchomić.' })));
    } finally {
      setAiLoading(false);
    }
  };

  const createNoResponseWorkflow = async () => {
    if (!workflowOddzialId) {
      setMsg(t('crm.pipeline.workflows.branchRequired', { defaultValue: 'Wybierz oddział dla automatyzacji.' }));
      return;
    }
    try {
      setSavingWorkflow(true);
      await api.post(
        '/crm/workflows',
        {
          oddzial_id: Number(workflowOddzialId),
          name: t('crm.pipeline.workflows.noResponseName', { defaultValue: 'Brak odpowiedzi 24h' }),
          trigger_type: 'no_response_after_hours',
          trigger_config: { hours: 24 },
          action_type: 'create_followup_task',
          action_config: {
            due_in_hours: 2,
            text: t('crm.pipeline.workflows.noResponseTask', { defaultValue: 'Follow-up: klient nie odpowiedział od 24h' }),
          },
        },
        { headers: requestHeaders }
      );
      await loadWorkflows();
    } catch (e) {
      setMsg(getApiErrorMessage(e, t('crm.pipeline.workflows.createError', { defaultValue: 'Nie udało się zapisać automatyzacji.' })));
    } finally {
      setSavingWorkflow(false);
    }
  };

  const createRoundRobinWorkflow = async () => {
    if (!workflowOddzialId) {
      setMsg(t('crm.pipeline.workflows.branchRequired', { defaultValue: 'Wybierz oddział dla automatyzacji.' }));
      return;
    }
    const userIds = roundRobinOwners.map((owner) => Number(owner.id)).filter(Boolean);
    if (userIds.length < 2) {
      setMsg(t('crm.pipeline.workflows.roundRobinNeedUsers', { defaultValue: 'Round-robin wymaga co najmniej dwóch ownerów.' }));
      return;
    }
    try {
      setSavingWorkflow(true);
      await api.post(
        '/crm/workflows',
        {
          oddzial_id: Number(workflowOddzialId),
          name: t('crm.pipeline.workflows.roundRobinName', { defaultValue: 'Round Robin leadów' }),
          trigger_type: 'unassigned_leads',
          trigger_config: { stages: ['Lead'] },
          action_type: 'assign_round_robin',
          action_config: { user_ids: userIds },
        },
        { headers: requestHeaders }
      );
      await loadWorkflows();
    } catch (e) {
      setMsg(getApiErrorMessage(e, t('crm.pipeline.workflows.createError', { defaultValue: 'Nie udało się zapisać automatyzacji.' })));
    } finally {
      setSavingWorkflow(false);
    }
  };

  const createTemplate = async () => {
    if (!templateForm.name.trim() || !templateForm.body.trim()) return;
    try {
      setSavingTemplate(true);
      await api.post(
        '/crm/message-templates',
        {
          oddzial_id: workflowOddzialId ? Number(workflowOddzialId) : undefined,
          ...templateForm,
          name: templateForm.name.trim(),
          key: templateForm.key.trim() || undefined,
          subject: templateForm.subject.trim() || null,
          body: templateForm.body.trim(),
        },
        { headers: requestHeaders }
      );
      setTemplateForm(EMPTY_TEMPLATE);
      await loadMessageTemplates();
    } catch (e) {
      setMsg(getApiErrorMessage(e, t('crm.pipeline.templates.createError', { defaultValue: 'Nie udało się zapisać szablonu.' })));
    } finally {
      setSavingTemplate(false);
    }
  };

  const createTemplateWorkflow = async () => {
    const template = messageTemplates[0];
    if (!workflowOddzialId || !template) {
      setMsg(t('crm.pipeline.workflows.templateRequired', { defaultValue: 'Dodaj najpierw szablon dla automatyzacji.' }));
      return;
    }
    try {
      setSavingWorkflow(true);
      await api.post(
        '/crm/workflows',
        {
          oddzial_id: Number(workflowOddzialId),
          name: t('crm.pipeline.workflows.templateName', { defaultValue: 'Brak odpowiedzi 24h: wyślij szablon' }),
          trigger_type: 'no_response_after_hours',
          trigger_config: { hours: 24 },
          action_type: 'send_template_message',
          action_config: { template_id: Number(template.id), channel: template.channel },
        },
        { headers: requestHeaders }
      );
      await loadWorkflows();
    } catch (e) {
      setMsg(getApiErrorMessage(e, t('crm.pipeline.workflows.createError', { defaultValue: 'Nie udało się zapisać automatyzacji.' })));
    } finally {
      setSavingWorkflow(false);
    }
  };

  const runWorkflows = async () => {
    if (!workflowOddzialId) return;
    try {
      setSavingWorkflow(true);
      const res = await api.post('/crm/workflows/run', { oddzial_id: Number(workflowOddzialId) }, { headers: requestHeaders });
      const count = Number(res.data?.actions_count || 0);
      setMsg(t('crm.pipeline.workflows.runDone', { defaultValue: 'Automatyzacje wykonane: {{count}} akcji.', count }));
      await Promise.all([loadData(), loadWorkflows(), selectedLeadId ? loadWorkflowEvents(selectedLeadId) : Promise.resolve()]);
    } catch (e) {
      setMsg(getApiErrorMessage(e, t('crm.pipeline.workflows.runError', { defaultValue: 'Nie udało się uruchomić automatyzacji.' })));
    } finally {
      setSavingWorkflow(false);
    }
  };

  const messageChannelLabel = (channel) => {
    const labels = {
      whatsapp: 'WhatsApp',
      instagram: 'Instagram',
      facebook: 'Facebook',
      messenger: 'Messenger',
      telegram: 'Telegram',
      email: 'E-mail',
      sms: 'SMS',
      phone: 'Telefon',
      webchat: 'Webchat',
      other: 'Inne',
    };
    return labels[channel] || labels.other;
  };

  const workflowEventStatusLabel = (status) => {
    if (status === 'completed') return t('crm.pipeline.workflowEvents.completed', { defaultValue: 'wykonane' });
    if (status === 'skipped') return t('crm.pipeline.workflowEvents.skipped', { defaultValue: 'pominięte' });
    if (status === 'error') return t('crm.pipeline.workflowEvents.error', { defaultValue: 'błąd' });
    return status || '—';
  };

  const npsGroupLabel = (group) => {
    if (group === 'promoter') return t('crm.pipeline.nps.promoter', { defaultValue: 'promotor' });
    if (group === 'passive') return t('crm.pipeline.nps.passive', { defaultValue: 'pasywny' });
    if (group === 'detractor') return t('crm.pipeline.nps.detractor', { defaultValue: 'krytyk' });
    return group || '—';
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

          <section className="ios-inset" style={{ padding: 12, marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 10 }}>
              <div>
                <div style={{ fontWeight: 800 }}>{t('crm.pipeline.templates.title', { defaultValue: 'Szablony wiadomości' })}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {t('crm.pipeline.templates.subtitle', { defaultValue: 'Centrum odpowiedzi dla Inbox i automatyzacji.' })}
                </div>
              </div>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{messageTemplates.length} aktywne</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
              <input
                className="ios-field"
                value={templateForm.name}
                onChange={(e) => setTemplateForm((prev) => ({ ...prev, name: e.target.value }))}
                placeholder={t('crm.pipeline.templates.name', { defaultValue: 'Nazwa szablonu' })}
              />
              <input
                className="ios-field"
                value={templateForm.key}
                onChange={(e) => setTemplateForm((prev) => ({ ...prev, key: e.target.value }))}
                placeholder={t('crm.pipeline.templates.key', { defaultValue: 'Klucz (opcjonalnie)' })}
              />
              <select
                className="ios-field"
                value={templateForm.channel}
                onChange={(e) => setTemplateForm((prev) => ({ ...prev, channel: e.target.value }))}
              >
                {['whatsapp', 'email', 'sms', 'phone', 'webchat', 'other'].map((channel) => (
                  <option key={channel} value={channel}>{messageChannelLabel(channel)}</option>
                ))}
              </select>
              <input
                className="ios-field"
                value={templateForm.subject}
                onChange={(e) => setTemplateForm((prev) => ({ ...prev, subject: e.target.value }))}
                placeholder={t('crm.pipeline.templates.subject', { defaultValue: 'Temat (opcjonalnie)' })}
              />
              <textarea
                className="ios-field"
                rows={2}
                value={templateForm.body}
                onChange={(e) => setTemplateForm((prev) => ({ ...prev, body: e.target.value }))}
                placeholder={t('crm.pipeline.templates.body', { defaultValue: 'Treść, np. Dzień dobry, wracam w sprawie {title}.' })}
                style={{ gridColumn: '1 / -1' }}
              />
              <button type="button" className="ios-btn ios-btn-primary" disabled={savingTemplate || !templateForm.name.trim() || !templateForm.body.trim()} onClick={createTemplate}>
                {t('crm.pipeline.templates.add', { defaultValue: 'Dodaj szablon' })}
              </button>
            </div>
            <div className="ios-inset-list" style={{ marginTop: 10, maxHeight: 180, overflow: 'auto' }}>
              {messageTemplates.map((template) => (
                <div key={template.id} className="ios-inset-row" style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{template.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{template.body}</div>
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 700 }}>{messageChannelLabel(template.channel)}</span>
                </div>
              ))}
              {messageTemplates.length === 0 ? (
                <div className="ios-inset-row muted">{t('crm.pipeline.templates.empty', { defaultValue: 'Brak szablonów wiadomości.' })}</div>
              ) : null}
            </div>
          </section>

          <section className="ios-inset" style={{ padding: 12, marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontWeight: 800 }}>{t('crm.pipeline.workflows.title', { defaultValue: 'Automatyzacje' })}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {t('crm.pipeline.workflows.subtitle', { defaultValue: 'Follow-upy i akcje workflow dla wybranego oddziału.' })}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="ios-btn"
                  disabled={savingWorkflow || workflows.some((rule) => rule.trigger_type === 'no_response_after_hours')}
                  onClick={createNoResponseWorkflow}
                >
                  {t('crm.pipeline.workflows.addNoResponse', { defaultValue: '+ brak odpowiedzi 24h' })}
                </button>
                <button
                  type="button"
                  className="ios-btn"
                  disabled={savingWorkflow || roundRobinOwners.length < 2 || workflows.some((rule) => rule.action_type === 'assign_round_robin')}
                  onClick={createRoundRobinWorkflow}
                >
                  {t('crm.pipeline.workflows.addRoundRobin', { defaultValue: '+ round-robin' })}
                </button>
                <button
                  type="button"
                  className="ios-btn"
                  disabled={savingWorkflow || messageTemplates.length === 0 || workflows.some((rule) => rule.action_type === 'send_template_message')}
                  onClick={createTemplateWorkflow}
                >
                  {t('crm.pipeline.workflows.addTemplate', { defaultValue: '+ wyślij szablon 24h' })}
                </button>
                <button type="button" className="ios-btn ios-btn-primary" disabled={savingWorkflow || workflows.length === 0} onClick={runWorkflows}>
                  {t('crm.pipeline.workflows.run', { defaultValue: 'Uruchom workflow' })}
                </button>
              </div>
            </div>
            <div className="ios-inset-list" style={{ marginTop: 10 }}>
              {workflows.map((rule) => (
                <div key={rule.id} className="ios-inset-row" style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{rule.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {rule.trigger_type} -> {rule.action_type}
                    </div>
                  </div>
                  <span style={{ fontSize: 12, color: rule.active ? 'var(--success)' : 'var(--text-muted)', fontWeight: 700 }}>
                    {rule.active ? t('crm.pipeline.workflows.active', { defaultValue: 'Aktywna' }) : t('crm.pipeline.workflows.inactive', { defaultValue: 'Pauza' })}
                  </span>
                </div>
              ))}
              {!workflowsLoading && workflows.length === 0 ? (
                <div className="ios-inset-row muted">
                  {t('crm.pipeline.workflows.empty', { defaultValue: 'Brak reguł workflow dla tego oddziału.' })}
                </div>
              ) : null}
              {workflowsLoading ? (
                <div className="ios-inset-row muted">{t('common.loading', { defaultValue: 'Ładowanie...' })}</div>
              ) : null}
            </div>
          </section>

          <section style={{ display: 'grid', gridTemplateColumns: `repeat(${STAGES.length}, minmax(220px, 1fr))`, gap: 10, overflowX: 'auto' }}>
            {STAGES.map((stage) => (
              <div
                key={stage}
                className="ios-inset"
                style={{ minHeight: 280, padding: 10 }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={async () => {
                  if (!dragLeadId) return;
                  const leadId = dragLeadId;
                  setDragLeadId(null);
                  await requestStageChange(leadId, stage);
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
                            letterSpacing: 0,
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
                      {lead.close_reason ? (
                        <div style={{ fontSize: 11, color: isTechnicalCloseReason(lead.close_reason) ? 'var(--warning)' : 'var(--text-muted)', fontWeight: 700 }}>
                          {isTechnicalCloseReason(lead.close_reason)
                            ? t('crm.pipeline.technicalReason', { defaultValue: 'Techniczny' })
                            : t('crm.pipeline.closeReason', { defaultValue: 'Powód' })}: {lead.close_reason}
                        </div>
                      ) : null}
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
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {!isClosedLeadStage(lead.stage) ? (
                          <button type="button" className="ios-btn" onClick={() => setCloseDialog({ leadId: lead.id, requestedStage: 'Przegrane', reason: '' })}>
                            {t('crm.pipeline.closeLead', { defaultValue: 'Zamknij lead' })}
                          </button>
                        ) : null}
                        <button type="button" className="ios-btn" onClick={() => handleDelete(lead.id)}>
                        {t('crm.pipeline.deleteLead', { defaultValue: 'Usuń' })}
                        </button>
                      </div>
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

      {closeDialog ? (
        <>
          <div
            role="presentation"
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 280 }}
            onClick={() => setCloseDialog(null)}
          />
          <section
            className="ios-inset"
            role="dialog"
            aria-modal="true"
            aria-label={t('crm.pipeline.closeDialogTitle', { defaultValue: 'Zamknięcie leada' })}
            style={{
              position: 'fixed',
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)',
              zIndex: 290,
              width: 'min(460px, calc(100vw - 32px))',
              padding: 16,
              display: 'grid',
              gap: 12,
              background: 'var(--surface-glass)',
              border: '1px solid var(--border)',
              boxShadow: 'var(--shadow-lg)',
            }}
          >
            <div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
                {t('crm.pipeline.closeDialogTitle', { defaultValue: 'Zamknięcie leada' })}
              </div>
              <div style={{ fontWeight: 800, fontSize: 17 }}>{closingLead?.title || `#${closeDialog.leadId}`}</div>
            </div>
            <label style={{ display: 'grid', gap: 6, fontSize: 13, color: 'var(--text-sub)', fontWeight: 700 }}>
              {t('crm.pipeline.closeReasonRequiredLabel', { defaultValue: 'Powód zamknięcia (wymagany)' })}
              <select
                className="ios-field"
                required
                value={closeDialog.reason}
                onChange={(e) => setCloseDialog((prev) => ({ ...prev, reason: e.target.value }))}
              >
                <option value="">{t('crm.pipeline.closeReasonPlaceholder', { defaultValue: 'Wybierz powód' })}</option>
                {CRM_CLOSE_REASONS.map((reason) => (
                  <option key={reason} value={reason}>
                    {reason}
                  </option>
                ))}
              </select>
            </label>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.45 }}>
              {closeDialog.reason && isTechnicalCloseReason(closeDialog.reason)
                ? t('crm.pipeline.closeTechnicalHint', { defaultValue: 'Ten powód trafi do lejka technicznego i nie będzie psuł konwersji specjalistów.' })
                : t('crm.pipeline.closeLostHint', { defaultValue: 'Ten powód zamknie lead jako przegrany.' })}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="ios-btn" onClick={() => setCloseDialog(null)}>
                {t('common.cancel', { defaultValue: 'Anuluj' })}
              </button>
              <button type="button" className="ios-btn ios-btn-primary" disabled={!closeDialog.reason} onClick={submitCloseLead}>
                {t('crm.pipeline.closeConfirm', { defaultValue: 'Zamknij lead' })}
              </button>
            </div>
          </section>
        </>
      ) : null}

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
              background: 'var(--surface-glass)',
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
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 700 }}>
                    {t('crm.pipeline.ai.title', { defaultValue: 'AI Lead Assistant' })}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {t('crm.pipeline.ai.subtitle', { defaultValue: 'Podsumowanie, następna akcja i propozycja odpowiedzi.' })}
                  </div>
                </div>
                <button type="button" className="ios-btn ios-btn-primary" disabled={aiLoading} onClick={runLeadAi}>
                  {aiLoading ? t('common.loading', { defaultValue: 'Ładowanie...' }) : t('crm.pipeline.ai.run', { defaultValue: 'Analizuj' })}
                </button>
              </div>
              {aiLead ? (
                <div className="ios-inset-list">
                  <div className="ios-inset-row">
                    <strong>{t('crm.pipeline.ai.summary', { defaultValue: 'Podsumowanie' })}</strong>
                    <div style={{ marginTop: 4 }}>{aiLead.summary || '—'}</div>
                  </div>
                  <div className="ios-inset-row">
                    <strong>{t('crm.pipeline.ai.nextAction', { defaultValue: 'Następna akcja' })}</strong>
                    <div style={{ marginTop: 4 }}>{aiLead.next_best_action || '—'}</div>
                  </div>
                  <div className="ios-inset-row">
                    <strong>{t('crm.pipeline.ai.reply', { defaultValue: 'Propozycja odpowiedzi' })}</strong>
                    <div style={{ marginTop: 4 }}>{aiLead.suggested_reply || '—'}</div>
                  </div>
                  <div className="ios-inset-row" style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span>{t('crm.pipeline.ai.score', { defaultValue: 'Score' })}: <strong>{aiLead.lead_score ?? '—'}</strong></span>
                    <span>{t('crm.pipeline.ai.risk', { defaultValue: 'Ryzyko' })}: <strong>{aiLead.risk || '—'}</strong></span>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="ios-inset" style={{ padding: 10, display: 'grid', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 700 }}>
                    {t('crm.pipeline.messages.title', { defaultValue: 'Unified Inbox' })}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {t('crm.pipeline.messages.subtitle', { defaultValue: 'WhatsApp, social, e-mail, SMS i webchat w jednej historii.' })}
                  </div>
                </div>
                {messagesLoading ? <span className="muted" style={{ fontSize: 12 }}>{t('common.loading', { defaultValue: 'Ładowanie...' })}</span> : null}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                <select
                  className="ios-field"
                  value={messageForm.channel}
                  onChange={(e) => setMessageForm((prev) => ({ ...prev, channel: e.target.value }))}
                >
                  {['whatsapp', 'instagram', 'facebook', 'messenger', 'telegram', 'email', 'sms', 'phone', 'webchat', 'other'].map((channel) => (
                    <option key={channel} value={channel}>{messageChannelLabel(channel)}</option>
                  ))}
                </select>
                <select
                  className="ios-field"
                  value={messageForm.direction}
                  onChange={(e) => setMessageForm((prev) => ({ ...prev, direction: e.target.value }))}
                >
                  <option value="inbound">{t('crm.pipeline.messages.inbound', { defaultValue: 'Przychodząca' })}</option>
                  <option value="outbound">{t('crm.pipeline.messages.outbound', { defaultValue: 'Wychodząca' })}</option>
                </select>
              </div>
              <select
                className="ios-field"
                value={messageForm.template_id}
                onChange={(e) => {
                  const template = messageTemplates.find((item) => String(item.id) === String(e.target.value));
                  setMessageForm((prev) => ({
                    ...prev,
                    template_id: e.target.value,
                    channel: template?.channel || prev.channel,
                    subject: template?.subject || prev.subject,
                    body: template?.body || prev.body,
                    direction: 'outbound',
                  }));
                }}
              >
                <option value="">{t('crm.pipeline.messages.noTemplate', { defaultValue: 'Bez szablonu' })}</option>
                {messageTemplates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name} / {messageChannelLabel(template.channel)}
                  </option>
                ))}
              </select>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                <input
                  className="ios-field"
                  value={messageForm.sender_handle}
                  onChange={(e) => setMessageForm((prev) => ({ ...prev, sender_handle: e.target.value }))}
                  placeholder={t('crm.pipeline.messages.sender', { defaultValue: 'Nadawca / handle' })}
                />
                <input
                  className="ios-field"
                  value={messageForm.recipient_handle}
                  onChange={(e) => setMessageForm((prev) => ({ ...prev, recipient_handle: e.target.value }))}
                  placeholder={t('crm.pipeline.messages.recipient', { defaultValue: 'Odbiorca / handle' })}
                />
              </div>
              {messageForm.channel === 'email' ? (
                <input
                  className="ios-field"
                  value={messageForm.subject}
                  onChange={(e) => setMessageForm((prev) => ({ ...prev, subject: e.target.value }))}
                  placeholder={t('crm.pipeline.messages.subject', { defaultValue: 'Temat e-maila' })}
                />
              ) : null}
              <textarea
                className="ios-field"
                rows={3}
                value={messageForm.body}
                onChange={(e) => setMessageForm((prev) => ({ ...prev, body: e.target.value }))}
                placeholder={t('crm.pipeline.messages.body', { defaultValue: 'Treść wiadomości...' })}
              />
              <button type="button" className="ios-btn ios-btn-primary" disabled={savingMessage || (!messageForm.body.trim() && !messageForm.template_id)} onClick={submitMessage}>
                {t('crm.pipeline.messages.add', { defaultValue: 'Zapisz wiadomość' })}
              </button>
              <div className="ios-inset-list" style={{ maxHeight: 260, overflow: 'auto' }}>
                {messages.map((message) => (
                  <div key={message.id} className="ios-inset-row" style={{ display: 'grid', gap: 5 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 800, fontSize: 12 }}>
                        {messageChannelLabel(message.channel)} / {message.direction === 'outbound'
                          ? t('crm.pipeline.messages.outboundShort', { defaultValue: 'wychodząca' })
                          : t('crm.pipeline.messages.inboundShort', { defaultValue: 'przychodząca' })}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{formatActivityWhen(message.created_at, lng)}</span>
                    </div>
                    {message.subject ? <div style={{ fontSize: 12, fontWeight: 700 }}>{message.subject}</div> : null}
                    <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', lineHeight: 1.45 }}>{message.body}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {[message.sender_handle, message.recipient_handle, message.status].filter(Boolean).join(' -> ') || '—'}
                    </div>
                  </div>
                ))}
                {!messagesLoading && messages.length === 0 ? (
                  <div className="ios-inset-row muted">{t('crm.pipeline.messages.empty', { defaultValue: 'Brak wiadomości w tej rozmowie.' })}</div>
                ) : null}
              </div>
            </div>

            <div className="ios-inset" style={{ padding: 10, display: 'grid', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 700 }}>
                    {t('crm.pipeline.nps.title', { defaultValue: 'NPS klienta' })}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {t('crm.pipeline.nps.subtitle', { defaultValue: 'Ocena 0-10 zapisana przy leadzie.' })}
                  </div>
                </div>
                {npsLoading ? <span className="muted" style={{ fontSize: 12 }}>{t('common.loading', { defaultValue: 'Ładowanie...' })}</span> : null}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '84px 1fr', gap: 6 }}>
                <input
                  className="ios-field"
                  type="number"
                  min="0"
                  max="10"
                  value={npsForm.score}
                  onChange={(e) => setNpsForm((prev) => ({ ...prev, score: e.target.value }))}
                  aria-label={t('crm.pipeline.nps.score', { defaultValue: 'Ocena NPS' })}
                />
                <select
                  className="ios-field"
                  value={npsForm.channel}
                  onChange={(e) => setNpsForm((prev) => ({ ...prev, channel: e.target.value }))}
                >
                  {['phone', 'sms', 'email', 'whatsapp', 'manual', 'other'].map((channel) => (
                    <option key={channel} value={channel}>{messageChannelLabel(channel)}</option>
                  ))}
                </select>
              </div>
              <textarea
                className="ios-field"
                rows={2}
                value={npsForm.comment}
                onChange={(e) => setNpsForm((prev) => ({ ...prev, comment: e.target.value }))}
                placeholder={t('crm.pipeline.nps.comment', { defaultValue: 'Komentarz klienta...' })}
              />
              <button type="button" className="ios-btn ios-btn-primary" disabled={savingNps} onClick={submitNps}>
                {t('crm.pipeline.nps.add', { defaultValue: 'Zapisz NPS' })}
              </button>
              <div className="ios-inset-list" style={{ maxHeight: 180, overflow: 'auto' }}>
                {npsSurveys.map((survey) => (
                  <div key={survey.id} className="ios-inset-row" style={{ display: 'grid', gap: 4 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <strong>{survey.score}/10 · {npsGroupLabel(survey.nps_group)}</strong>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{formatActivityWhen(survey.responded_at || survey.created_at, lng)}</span>
                    </div>
                    {survey.comment ? <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{survey.comment}</div> : null}
                  </div>
                ))}
                {!npsLoading && npsSurveys.length === 0 ? (
                  <div className="ios-inset-row muted">{t('crm.pipeline.nps.empty', { defaultValue: 'Brak ocen NPS przy tym leadzie.' })}</div>
                ) : null}
              </div>
            </div>

            <div className="ios-inset" style={{ padding: 10, display: 'grid', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 700 }}>
                    {t('crm.pipeline.workflowEvents.title', { defaultValue: 'Automatyzacje' })}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {t('crm.pipeline.workflowEvents.subtitle', { defaultValue: 'Co system zrobił lub pominął przy tym leadzie.' })}
                  </div>
                </div>
                {workflowEventsLoading ? <span className="muted" style={{ fontSize: 12 }}>{t('common.loading', { defaultValue: 'Ładowanie...' })}</span> : null}
              </div>
              <div className="ios-inset-list" style={{ maxHeight: 220, overflow: 'auto' }}>
                {workflowEvents.map((event) => (
                  <div key={event.id} className="ios-inset-row" style={{ display: 'grid', gap: 5 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 800, fontSize: 12 }}>{event.workflow_name || `Workflow #${event.workflow_id || '—'}`}</span>
                      <span style={{
                        fontSize: 11,
                        color: event.status === 'error' ? 'var(--danger)' : event.status === 'skipped' ? 'var(--text-muted)' : 'var(--accent)',
                        fontWeight: 800,
                      }}>
                        {workflowEventStatusLabel(event.status)}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {event.trigger_type || '—'} -&gt; {event.action_type || '—'} · {formatActivityWhen(event.created_at, lng)}
                    </div>
                    {event.reason ? <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{event.reason}</div> : null}
                  </div>
                ))}
                {!workflowEventsLoading && workflowEvents.length === 0 ? (
                  <div className="ios-inset-row muted">{t('crm.pipeline.workflowEvents.empty', { defaultValue: 'Brak historii automatyzacji.' })}</div>
                ) : null}
              </div>
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
