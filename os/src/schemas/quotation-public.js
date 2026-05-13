const { z } = require('zod');

/**
 * Body publicznego endpointu /api/public/quotations/:token/choice.
 * Formularz HTML wysyła action=accept|reject — wszystko poza tym zostaje
 * odrzucone z błędem walidacji 400 zanim trafi do logiki bazodanowej.
 */
const quotationChoiceBodySchema = z
  .object({
    action: z.enum(['accept', 'reject']),
  })
  .strict();

/** Param :token — losowy ciąg z URL akceptacji. Ograniczamy długość, by uniknąć abuse. */
const quotationTokenParamsSchema = z.object({
  token: z
    .string()
    .min(8, 'Token zbyt krótki')
    .max(128, 'Token zbyt długi')
    .regex(/^[A-Za-z0-9_-]+$/, 'Token zawiera niedozwolone znaki'),
});

module.exports = {
  quotationChoiceBodySchema,
  quotationTokenParamsSchema,
};
