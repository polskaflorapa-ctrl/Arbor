/** Cyfry i wiodący + — do URL `tel:` i wysyłki SMS. */
export function normalizePhone(value) {
  return String(value || '').replace(/[^\d+]/g, '');
}

export function telHref(raw) {
  const n = normalizePhone(raw);
  if (!n) return null;
  return `tel:${n}`;
}
