/** Jednolity kształt komunikatów dla {@link ../components/StatusMessage.js StatusMessage} (bez emoji w treści). */

export function successMessage(text) {
  return { tone: 'success', text: String(text ?? '') };
}

export function warningMessage(text) {
  return { tone: 'warning', text: String(text ?? '') };
}

export function errorMessage(text) {
  return { tone: 'error', text: String(text ?? '') };
}

/**
 * Normalizuje string (stare prefiksy emoji) lub obiekt { tone, text }.
 * @param {unknown} value
 * @returns {{ tone: 'success'|'warning'|'error'|'neutral', text: string }}
 */
export function formatStatusMessage(value) {
  if (value && typeof value === 'object' && 'text' in value && 'tone' in value) {
    const tone = value.tone;
    const text = String(value.text ?? '');
    if (tone === 'success' || tone === 'warning' || tone === 'error' || tone === 'neutral') {
      return { tone, text };
    }
    return { tone: 'neutral', text };
  }
  if (typeof value === 'string') {
    let tone = 'neutral';
    if (value.includes('✅')) tone = 'success';
    else if (value.includes('⚠️')) tone = 'warning';
    else if (value.includes('❌')) tone = 'error';
    const text = value.replace(/^[\s]*(✅|⚠️|❌)\s*/u, '').trim();
    return { tone, text };
  }
  if (value == null) return { tone: 'neutral', text: '' };
  return { tone: 'neutral', text: String(value) };
}
