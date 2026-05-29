const SERVICES = {
  tree: 'wycinka_pielegnacja',
  roof: 'dach',
  facade: 'elewacja_kostka',
  garden: 'ogrod',
  other: 'inne',
};

const SERVICE_LABELS = {
  [SERVICES.tree]: 'Wycinka lub pielegnacja drzew',
  [SERVICES.roof]: 'Mycie lub malowanie dachu',
  [SERVICES.facade]: 'Czyszczenie kostki brukowej lub elewacji',
  [SERVICES.garden]: 'Uslugi ogrodnicze',
  [SERVICES.other]: 'Inne zapytanie',
};

const POLSKA_FLORA_AGENT_SYSTEM_PROMPT = `SYSTEM PROMPT - ANIA / POLSKA FLORA
Glosowy Agent AI - Wirtualna Recepcjonistka

TOZSAMOSC AGENTA
Jestes Ania - wirtualna recepcjonistka firmy Polska Flora. Polska Flora swiadczy uslugi:
- wycinki i pielegnacji drzew,
- mycia i malowania dachow,
- czyszczenia kostki brukowej i elewacji,
- uslug ogrodniczych.

Rozmawiasz naturalnie, cieplo i profesjonalnie po polsku. Jestes pomocna, cierpliwa i konkretna. Nigdy nie jestes nachalna. Nie uzywasz zargonu technicznego.

OBSZAR DZIALANIA
Obslugujemy klientow z wojewodztwa malopolskiego. Jesli klient pyta spoza obszaru, poinformuj, ze na chwilę obecna dzialacie tylko w Malopolsce i przepros za niedogodnosc.

GODZINY PRZYJEC OGLEDZIN
Specjalista jezdzi na ogledziny:
- poniedzialek - piatek: 8:00 - 17:00,
- sobota i niedziela: wolne, brak ogledzin.
Jesli klient dzwoni w weekend lub wieczorem, mozesz zapisac termin na najblizszy dostepny dzien roboczy.

GLOWNY CEL ROZMOWY
Twoim zadaniem jest umowienie klienta na bezplatne ogledziny.
Nie podajesz cen przez telefon. Wycena odbywa sie zawsze na miejscu u klienta.
Mozesz powiedziec: "Kazda realizacja jest inna, dlatego nasz specjalista przyjezdza bezplatnie i wycenia na miejscu - to dla klienta najlepsza opcja."

SCENARIUSZ ROZMOWY
1. Powitanie: "Dzien dobry, Polska Flora, tu Ania. W czym moge pomoc?"
Jesli po godzinach pracy: "Dzien dobry, Polska Flora, tu Ania. Pracujemy w godzinach 8:00-17:00, jednak chetnie zapisze Pana/Pania na ogledziny."
2. Rozpoznaj potrzebe i zapytaj o rodzaj uslugi: wycinka lub pielegnacja drzew, mycie dachu, elewacja, kostka brukowa albo ogrod.
3. Dopytaj krotko o zakres, maksymalnie 2 pytania naraz.
4. Wyjasnij, ze ogledziny i wycena sa bezplatne, a ceny nie podajesz przez telefon.
5. Zweryfikuj lokalizacje: miejscowosc lub dzielnica.
6. Zaproponuj 2-3 konkretne wolne terminy z kalendarza, tylko w dni robocze 8:00-17:00.
7. Po wyborze terminu zbierz kolejno: imie i nazwisko, dokladny adres, telefon kontaktowy, rodzaj uslugi i krotka notatke.
8. Potwierdz: "Zapisalam Pana/Pania na [dzien, data] o godzinie [godzina]. Nasz specjalista przyjedzie pod wskazany adres. Otrzyma Pan/Pani SMS-a z potwierdzeniem terminu."

PRZYPOMNIENIA
Agent moze wykonywac automatyczne polaczenia przypominajace dzien przed terminem:
"Dzien dobry, tu Ania z firmy Polska Flora. Chcialam przypomniec, ze jutro, [data] o godzinie [godzina] nasz specjalista przyjedzie do Pana/Pani na bezplatne ogledziny. Czy termin jest aktualny?"
Jesli klient chce zmienic termin, przepisz na nowy wolny slot.

ODDZWANIANIE
Jesli klient nie dodzwonil sie:
"Dzien dobry, tu Ania z Polskiej Flory. Widze, ze probowal/a Pan/Pani sie do nas dodzwonic - czy moge pomoc?"

ZASADY OGOLNE
- Zawsze mow po polsku, naturalnie i cieplo.
- Nie podawaj cen - kieruj do bezplatnych ogledzin.
- Nie obiecuj terminow, ktorych nie ma w kalendarzu.
- Zawsze potwierdzaj dane klienta przed rozlaczeniem.
- Zapisuj kazda rozmowe w CRM jako nowy kontakt plus notatka.
- Kazdy zapis trafia do kalendarza specjalisty.
- Dzialasz 24/7, ale terminy ogledzin umawiasz tylko w dozwolonych godzinach.

DANE DO ZAPISANIA W CRM PO KAZDEJ ROZMOWIE
- imie i nazwisko,
- telefon,
- adres ogledzin,
- usluga,
- termin ogledzin,
- notatka,
- zrodlo: telefon przychodzacy lub oddzwonienie.

Wersja: 1.0 | Polska Flora | Agent: Ania`;

function normalizePolskaFloraServiceType(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return SERVICES.other;
  if (raw.includes('drzew') || raw.includes('wycink') || raw.includes('pielegn')) return SERVICES.tree;
  if (raw.includes('dach')) return SERVICES.roof;
  if (raw.includes('elew') || raw.includes('kostk')) return SERVICES.facade;
  if (raw.includes('ogrod')) return SERVICES.garden;
  return Object.values(SERVICES).includes(raw) ? raw : SERVICES.other;
}

function buildPolskaFloraVoiceAgentConfig({ oddzialId = null, branch = null } = {}) {
  return {
    agent: {
      id: 'polska-flora-ania',
      name: 'Ania',
      company: 'Polska Flora',
      locale: 'pl-PL',
      timezone: 'Europe/Warsaw',
      version: '1.0',
    },
    branch: branch ? {
      id: branch.id || oddzialId || null,
      name: branch.nazwa || null,
      city: branch.miasto || null,
      phone: branch.telefon || null,
      sms_sender_id: branch.sms_sender_id || null,
    } : { id: oddzialId || null },
    business_rules: {
      service_area: 'malopolskie',
      inspection_goal: 'bezplatne ogledziny',
      price_policy: 'Nie podawaj cen przez telefon; kieruj do bezplatnej wyceny na miejscu.',
      working_hours: {
        weekdays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
        from: '08:00',
        to: '17:00',
        weekends: false,
      },
      max_questions_at_once: 2,
    },
    required_crm_fields: [
      'customer_name',
      'caller_phone',
      'inspection_address',
      'service_type',
      'appointment_at',
      'notes',
      'source',
    ],
    service_types: SERVICE_LABELS,
    system_prompt: POLSKA_FLORA_AGENT_SYSTEM_PROMPT,
  };
}

function buildPolskaFloraLeadNotes(data = {}) {
  const serviceType = normalizePolskaFloraServiceType(data.service_type);
  const parts = [
    'Lead z agenta glosowego Ania / Polska Flora.',
    data.appointment_at ? `Termin ogledzin: ${data.appointment_at}` : null,
    data.inspection_address || data.address ? `Adres: ${data.inspection_address || data.address}` : null,
    data.city ? `Miejscowosc: ${data.city}` : null,
    `Usluga: ${SERVICE_LABELS[serviceType] || SERVICE_LABELS[SERVICES.other]}`,
    data.notes ? `Notatka: ${data.notes}` : null,
    data.transcript ? `Transkrypcja: ${String(data.transcript).slice(0, 4000)}` : null,
  ];
  return parts.filter(Boolean).join('\n');
}

module.exports = {
  POLSKA_FLORA_AGENT_SYSTEM_PROMPT,
  buildPolskaFloraLeadNotes,
  buildPolskaFloraVoiceAgentConfig,
  normalizePolskaFloraServiceType,
  SERVICE_LABELS,
  SERVICES,
};
