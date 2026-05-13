const NEW_ORDER_PATH = '/nowe-zlecenie';

export function buildNewOrderPath(params = {}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value == null) return;
    const normalized = String(value).trim();
    if (!normalized) return;
    qs.set(key, normalized);
  });
  const query = qs.toString();
  return query ? `${NEW_ORDER_PATH}?${query}` : NEW_ORDER_PATH;
}
