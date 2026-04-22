const { z } = require('zod');

const optionalIntId = z
  .any()
  .optional()
  .transform((v) => {
    if (v === undefined || v === null || v === '') return null;
    const n = parseInt(String(v), 10);
    return Number.isNaN(n) ? null : n;
  });

const invoiceItemSchema = z.object({
  nazwa: z.string().trim().min(1, 'Nazwa pozycji jest wymagana'),
  jednostka: z.string().max(20).optional(),
  ilosc: z.coerce.number().positive(),
  cena_netto: z.coerce.number(),
  vat_stawka: z.coerce.number(),
});

const invoiceCreateBodySchema = z.object({
  task_id: optionalIntId,
  klient_nazwa: z.string().trim().min(1, 'Nazwa klienta jest wymagana'),
  klient_nip: z.string().max(20).optional().nullable(),
  klient_adres: z.string().optional().nullable(),
  klient_email: z.string().max(100).optional().nullable(),
  klient_typ: z.string().max(20).optional().nullable(),
  data_wystawienia: z.string().max(20).optional().nullable(),
  data_sprzedazy: z.string().max(20).optional().nullable(),
  termin_platnosci: z.string().max(20).optional().nullable(),
  forma_platnosci: z.string().max(50).optional().nullable(),
  uwagi: z.string().optional().nullable(),
  oddzial_id: optionalIntId,
  pozycje: z.array(invoiceItemSchema).min(1, 'Wymagana jest co najmniej jedna pozycja faktury'),
});

const invoiceIdParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const invoiceStatusBodySchema = z.object({
  status: z.string().trim().min(1).max(50),
});

module.exports = {
  invoiceItemSchema,
  invoiceCreateBodySchema,
  invoiceIdParamsSchema,
  invoiceStatusBodySchema,
  optionalIntId,
};
