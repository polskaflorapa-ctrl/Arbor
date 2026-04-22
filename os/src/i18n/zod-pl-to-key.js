/**
 * Maps Zod default / custom Polish messages from schemas to i18n dotted keys.
 * Fallback in validate: unknown message left as-is.
 */
module.exports = {
  'Login jest wymagany': 'errors.validation.zod.loginRequired',
  'Haslo jest wymagane': 'errors.validation.zod.passwordRequired',
  'Stare haslo jest wymagane': 'errors.validation.zod.oldPasswordRequired',
  'Nowe haslo musi miec min. 8 znakow': 'errors.validation.zod.newPasswordMin8',
  'klient_nazwa jest wymagane': 'errors.validation.zod.clientNameRequired',
  'adres jest wymagany': 'errors.validation.zod.addressRequired',
  'miasto jest wymagane': 'errors.validation.zod.cityRequired',
  'data_planowana jest wymagana': 'errors.validation.zod.plannedDateRequired',
  'typ jest wymagany': 'errors.validation.zod.typeRequired',
  'Rola jest wymagana': 'errors.validation.zod.roleRequired',
  'Podaj telefon lub email': 'errors.klienci.phoneOrEmailRequired',
  'Podaj klient_id': 'errors.ogledziny.provideClientId',
  'Data raportu jest wymagana': 'errors.raportyDaily.reportDateRequired',
  'Wymagana jest co najmniej jedna pozycja faktury': 'errors.validation.zod.invoiceLinesMin1',
  'Nazwa klienta jest wymagana': 'errors.validation.zod.invoiceClientNameRequired',
  'Nazwa pozycji jest wymagana': 'errors.validation.zod.invoiceLineNameRequired',
  'Pole aktywny jest wymagane': 'errors.validation.zod.userActiveRequired',
  'Pole aktywny musi byc true lub false': 'errors.validation.zod.userActiveBoolean',
  'Podaj telefon i tresc SMS': 'errors.sms.phoneAndBodyRequired',
  'Nazwa roli jest wymagana': 'errors.role.roleNameRequired',
  'Nazwa oddzialu jest wymagana': 'errors.validation.zod.branchNameRequired',
  'Nazwa ekipy jest wymagana': 'errors.validation.zod.teamNameRequired',
  'Data pracy jest wymagana': 'errors.validation.zod.workDateRequired',
  'Tresc jest wymagana': 'errors.validation.zod.notificationBodyRequired',
  'Brak wiadomosci': 'errors.ai.messagesRequired',
  'Brak zdjecia': 'errors.ai.imageRequired',
};
