export function getApiErrorMessage(error, fallback = 'Wystąpił błąd. Spróbuj ponownie.') {
  const data = error?.response?.data || {};
  const missingLabels = Array.isArray(data?.missing_labels)
    ? data.missing_labels.map((label) => String(label || '').trim()).filter(Boolean)
    : [];
  if (data?.code === 'TASK_WORKFLOW_BLOCKED' && missingLabels.length) {
    const base = data.error || 'Nie mozna przejsc dalej bez wymaganych danych.';
    return `${base} Brakuje: ${missingLabels.join(', ')}.`;
  }
  const missingCompetencies = Array.isArray(data?.missing_competencies)
    ? data.missing_competencies.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  if (data?.code === 'TEAM_COMPETENCY_MISSING' && missingCompetencies.length) {
    return `Ekipa nie ma wymaganych kompetencji: ${missingCompetencies.join(', ')}.`;
  }
  const details =
    data?.details ||
    data?.detail ||
    data?.message;
  const normalizedDetails = Array.isArray(details) ? details.join(', ') : details;

  return (
    error?.userMessage ||
    normalizedDetails ||
    data?.error ||
    error?.message ||
    fallback
  );
}
