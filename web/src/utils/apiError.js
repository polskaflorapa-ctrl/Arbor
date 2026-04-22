export function getApiErrorMessage(error, fallback = 'Wystąpił błąd. Spróbuj ponownie.') {
  const details =
    error?.response?.data?.details ||
    error?.response?.data?.detail ||
    error?.response?.data?.message;
  const normalizedDetails = Array.isArray(details) ? details.join(', ') : details;

  return (
    error?.userMessage ||
    normalizedDetails ||
    error?.response?.data?.error ||
    error?.message ||
    fallback
  );
}

