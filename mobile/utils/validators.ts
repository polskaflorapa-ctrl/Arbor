export const isValidPolishPhone = (value: string): boolean => {
  const normalized = value.replace(/\s|-/g, '');
  if (!normalized) return true;
  return /^(\+48)?\d{9}$/.test(normalized);
};

export const isValidIsoDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

export const isValidTimeHHMM = (value: string): boolean => {
  if (!value) return true;
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(value);
};

export const isPositiveNumber = (value: string): boolean => {
  if (!value) return true;
  const numeric = Number(value.replace(',', '.'));
  return Number.isFinite(numeric) && numeric >= 0;
};
