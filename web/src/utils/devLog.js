export function devWarn(scope, message, error) {
  if (process.env.NODE_ENV !== 'production') {
    if (error !== undefined) {
      console.warn(`[${scope}] ${message}`, error);
      return;
    }
    console.warn(`[${scope}] ${message}`);
  }
}
