const { z } = require('zod');

/** Pola ustawień firmy (mobile + księgowość). */
const companySettingsWriteSchema = z.object({
  nazwa: z.string().max(200).optional().nullable(),
  nip: z.string().max(20).optional().nullable(),
  adres: z.string().optional().nullable(),
  kod_pocztowy: z.string().max(10).optional().nullable(),
  miasto: z.string().max(100).optional().nullable(),
  konto_bankowe: z.string().max(50).optional().nullable(),
  bank_nazwa: z.string().max(100).optional().nullable(),
  email: z.string().max(100).optional().nullable(),
  telefon: z.string().max(20).optional().nullable(),
});

module.exports = { companySettingsWriteSchema };
