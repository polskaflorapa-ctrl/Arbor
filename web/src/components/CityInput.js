import { useCallback, useId, useMemo, useState } from 'react';
import {
  clearRecentCities,
  getRecentCities,
  mergeCitySuggestions,
  saveRecentCity
} from '../utils/citySuggestions';
import { normalizeCityName } from '../utils/cityFormat';

export default function CityInput({
  value,
  onChange,
  extraCities = [],
  listId,
  onBlur,
  showRecentChips = true,
  maxSuggestions = 80,
  ...inputProps
}) {
  const reactId = useId().replace(/:/g, '');
  const resolvedListId = listId || `city-suggestions-${reactId}`;
  const options = useMemo(
    () => mergeCitySuggestions(extraCities, { maxItems: maxSuggestions }),
    [extraCities, maxSuggestions]
  );
  const [recentCities, setRecentCities] = useState(() => getRecentCities());

  const refreshRecentCities = useCallback(() => {
    setRecentCities(getRecentCities());
  }, []);

  const applyCityValue = (nextValue) => {
    const normalized = normalizeCityName(nextValue);
    saveRecentCity(normalized);
    onChange?.({ target: { value: normalized } });
    refreshRecentCities();
  };

  return (
    <>
      <input
        {...inputProps}
        value={value}
        onChange={onChange}
        onFocus={refreshRecentCities}
        onBlur={(event) => {
          const normalized = normalizeCityName(event.target.value);
          saveRecentCity(normalized);
          if (normalized !== event.target.value) {
            applyCityValue(normalized);
          }
          refreshRecentCities();
          onBlur?.(event);
        }}
        list={resolvedListId}
        autoComplete="address-level2"
      />
      {showRecentChips && recentCities.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', alignSelf: 'center' }}>
            Ostatnie:
          </span>
          {recentCities.map((city) => (
            <button
              key={city}
              type="button"
              onClick={() => applyCityValue(city)}
              style={{
                border: '1px solid var(--border)',
                borderRadius: 999,
                padding: '2px 8px',
                background: 'var(--bg-deep)',
                color: 'var(--text-sub)',
                fontSize: 11,
                cursor: 'pointer',
              }}>
              {city}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              clearRecentCities();
              refreshRecentCities();
            }}
            style={{
              border: '1px solid var(--border)',
              borderRadius: 999,
              padding: '2px 8px',
              background: 'transparent',
              color: 'var(--text-muted)',
              fontSize: 11,
              cursor: 'pointer',
            }}>
            Wyczyść
          </button>
        </div>
      )}
      <datalist id={resolvedListId}>
        {options.map((city) => (
          <option key={city} value={city} />
        ))}
      </datalist>
    </>
  );
}
