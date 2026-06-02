import { describe, expect, it } from 'vitest';
import { getApiErrorMessage } from './apiError';

describe('getApiErrorMessage', () => {
  it('formats unavailable team resources with concrete labels', () => {
    const message = getApiErrorMessage({
      response: {
        data: {
          code: 'TEAM_RESOURCE_UNAVAILABLE',
          items: [
            { kind: 'Sprzet', label: 'Rebak Forst', status: 'W naprawie' },
            { kind: 'Auto', label: 'Mercedes Sprinter KR1ARB', status: 'Serwis' },
          ],
        },
      },
    });

    expect(message).toBe(
      'Ekipa ma zasoby w naprawie: Sprzet: Rebak Forst (W naprawie), Auto: Mercedes Sprinter KR1ARB (Serwis). Zamknij naprawe albo wybierz inna ekipe.'
    );
  });
});
