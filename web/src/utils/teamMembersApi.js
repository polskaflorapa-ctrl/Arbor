import { getApiErrorMessage } from './apiError';
import { authHeaders } from './storedToken';

function asInt(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function buildAddPayloads(workerId, role) {
  return [
    { pracownik_id: workerId, rola: role },
    { user_id: workerId, rola: role },
    {
      user_id: workerId,
      pracownik_id: workerId,
      uzytkownik_id: workerId,
      userId: workerId,
      pracownikId: workerId,
      uzytkownikId: workerId,
      rola: role,
      rola_w_ekipie: role,
    },
    { user: { id: workerId }, rola: role },
  ];
}

function isDuplicateResponse(error) {
  const status = error?.response?.status;
  const msg = String(getApiErrorMessage(error, '')).toLowerCase();
  return (
    status === 409 ||
    status === 422 ||
    msg.includes('already') ||
    msg.includes('już') ||
    msg.includes('istnieje')
  );
}

export async function addTeamMember(api, token, ekipaId, workerIdInput, roleInput) {
  const workerId = asInt(workerIdInput);
  const role = String(roleInput || 'Pomocnik').trim() || 'Pomocnik';
  if (!workerId || !ekipaId) {
    throw new Error('Nieprawidłowe dane członka ekipy.');
  }

  const endpoints = [
    `/ekipy/${ekipaId}/czlonkowie`,
    `/ekipy/${ekipaId}/pracownicy`,
    `/ekipy/${ekipaId}/members`,
    `/ekipy/${ekipaId}/member`,
  ];
  const methods = ['post', 'put', 'patch'];
  const payloads = buildAddPayloads(workerId, role);
  let lastError = null;

  for (const endpoint of endpoints) {
    for (const method of methods) {
      for (const payload of payloads) {
        try {
          await api.request({
            url: endpoint,
            method,
            data: payload,
            headers: authHeaders(token),
          });
          return { duplicate: false };
        } catch (error) {
          lastError = error;
          if (isDuplicateResponse(error)) return { duplicate: true };
          const status = error?.response?.status;
          if (status === 500) throw error;
          if (status && status !== 404 && status !== 405 && status !== 422) throw error;
        }
      }
    }
  }

  if (lastError) throw lastError;
  throw new Error('Nie udało się dodać członka ekipy.');
}

export async function removeTeamMember(api, token, ekipaId, workerIdInput) {
  const workerId = asInt(workerIdInput);
  if (!workerId || !ekipaId) {
    throw new Error('Nieprawidłowe dane członka ekipy.');
  }

  const endpoints = [
    `/ekipy/${ekipaId}/czlonkowie/${workerId}`,
    `/ekipy/${ekipaId}/pracownicy/${workerId}`,
    `/ekipy/${ekipaId}/members/${workerId}`,
  ];
  let lastError = null;

  for (const endpoint of endpoints) {
    try {
      await api.delete(endpoint, { headers: authHeaders(token) });
      return;
    } catch (error) {
      lastError = error;
      const status = error?.response?.status;
      if (status === 500) throw error;
      if (status && status !== 404 && status !== 405 && status !== 422) throw error;
    }
  }

  if (lastError) throw lastError;
  throw new Error('Nie udało się usunąć członka ekipy.');
}
