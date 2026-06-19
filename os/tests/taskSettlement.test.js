const {
  grossForTask,
  isCashCollectionNoteMissing,
  isNoPaymentReasonMissing,
  CASH_COLLECTION_NOTE_PCT,
} = require('../src/services/taskSettlement');

describe('taskSettlement', () => {
  describe('grossForTask', () => {
    it('preferuje wartosc_rzeczywista', () => {
      expect(grossForTask({ wartosc_rzeczywista: 400, wartosc_planowana: 100 }, {})).toBe(400);
    });
    it('fallback do planowanej', () => {
      expect(grossForTask({ wartosc_rzeczywista: null, wartosc_planowana: 250 }, {})).toBe(250);
    });
    it('gotówka gdy brak wartości zadania', () => {
      expect(
        grossForTask(
          { wartosc_rzeczywista: 0, wartosc_planowana: 0 },
          { forma_platnosc: 'Gotowka', kwota_odebrana: 180 }
        )
      ).toBe(180);
    });
  });

  describe('isCashCollectionNoteMissing', () => {
    it('false dla nie-gotówki', () => {
      expect(isCashCollectionNoteMissing({ forma_platnosc: 'Przelew', kwota_odebrana: 200 }, 100, '')).toBe(false);
    });
    it('false przy różnicy ≤ progu', () => {
      const gross = 100;
      const collected = gross * (1 + CASH_COLLECTION_NOTE_PCT / 100);
      expect(isCashCollectionNoteMissing({ forma_platnosc: 'Gotowka', kwota_odebrana: collected }, gross, '')).toBe(
        false
      );
    });
    it('true przy różnicy > progu i braku notatki', () => {
      expect(isCashCollectionNoteMissing({ forma_platnosc: 'Gotowka', kwota_odebrana: 106 }, 100, '')).toBe(true);
    });
    it('false gdy jest notatka w payment', () => {
      expect(
        isCashCollectionNoteMissing({ forma_platnosc: 'Gotowka', kwota_odebrana: 200, notatki: ' rabat ' }, 100, '')
      ).toBe(false);
    });
    it('false gdy jest notatka w body finish', () => {
      expect(isCashCollectionNoteMissing({ forma_platnosc: 'Gotowka', kwota_odebrana: 200 }, 100, 'uzasadnienie')).toBe(
        false
      );
    });
  });

  describe('isNoPaymentReasonMissing', () => {
    it('true dla platnego zlecenia bez platnosci i bez notatki', () => {
      expect(isNoPaymentReasonMissing({ forma_platnosc: 'Brak' }, 250, '')).toBe(true);
    });

    it('false gdy brak platnosci ma uzasadnienie', () => {
      expect(isNoPaymentReasonMissing({ forma_platnosc: 'Brak', notatki: 'klient placi jutro' }, 250, '')).toBe(false);
    });

    it('false gdy zlecenie ma zerowa wartosc', () => {
      expect(isNoPaymentReasonMissing({ forma_platnosc: 'Brak' }, 0, '')).toBe(false);
    });
  });
});
