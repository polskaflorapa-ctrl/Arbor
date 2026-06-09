import type { ComponentProps } from 'react';
import { Ionicons } from '@expo/vector-icons';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

export type CommandCategory =
  | 'operations'
  | 'quotes'
  | 'fleetMagazyn'
  | 'reports'
  | 'finance'
  | 'administration'
  | 'account';

export interface CommandAction {
  id: string;
  label: string;
  path: string;
  icon: IoniconName;
  category: CommandCategory;
  keywords: string[];
  roles?: string[];
}

const MANAGEMENT_ROLES = ['Dyrektor', 'Administrator', 'Kierownik'];
const CREW_ROLES = ['Brygadzista', 'Pomocnik', 'Pomocnik bez doświadczenia'];

const ACTIONS: CommandAction[] = [
  {
    id: 'today-mission',
    label: 'Tryb Dzisiaj',
    path: '/misja-dnia',
    icon: 'navigate-circle-outline',
    category: 'operations',
    keywords: ['dzisiaj', 'misja', 'plan dnia', 'today', 'mission'],
  },
  {
    id: 'orders',
    label: 'Zlecenia',
    path: '/zlecenia',
    icon: 'clipboard-outline',
    category: 'operations',
    keywords: ['zlecenie', 'task', 'zadania'],
    roles: ['Dyrektor', 'Administrator', 'Kierownik', 'Brygadzista', 'Pomocnik', 'Pomocnik bez doświadczenia', 'Specjalista'],
  },
  {
    id: 'new-order',
    label: 'Nowe zlecenie',
    path: '/nowe-zlecenie',
    icon: 'add-circle-outline',
    category: 'operations',
    keywords: ['nowe', 'dodaj', 'zlecenie', 'create'],
    roles: MANAGEMENT_ROLES,
  },
  {
    id: 'schedule',
    label: 'Harmonogram',
    path: '/harmonogram',
    icon: 'calendar-outline',
    category: 'operations',
    keywords: ['plan', 'kalendarz', 'grafik', 'harmonogram'],
    roles: [...MANAGEMENT_ROLES, 'Magazynier', 'Brygadzista'],
  },
  {
    id: 'autoplan',
    label: 'Autoplan dnia',
    path: '/autoplan-dnia',
    icon: 'sparkles-outline',
    category: 'operations',
    keywords: ['autoplan', 'automatycznie', 'kolejność'],
    roles: MANAGEMENT_ROLES,
  },
  {
    id: 'quote-center',
    label: 'Centrum oględzin',
    path: '/wyceniajacy-hub',
    icon: 'speedometer-outline',
    category: 'quotes',
    keywords: ['wycena', 'hub', 'oględziny'],
    roles: ['Wyceniający'],
  },
  {
    id: 'field-quotes',
    label: 'Oględziny',
    path: '/wyceny-terenowe',
    icon: 'document-text-outline',
    category: 'quotes',
    keywords: ['teren', 'wyceny', 'oględziny', 'u klienta'],
    roles: ['Wyceniający', 'Dyrektor', 'Administrator', 'Kierownik'],
  },
  {
    id: 'quote-calendar',
    label: 'Kalendarz oględzin',
    path: '/wycena-kalendarz',
    icon: 'calculator-outline',
    category: 'quotes',
    keywords: ['kalendarz', 'wycena', 'oględziny', 'terminy'],
    roles: ['Wyceniający', 'Specjalista', 'Brygadzista', ...MANAGEMENT_ROLES],
  },
  {
    id: 'approvals',
    label: 'Zatwierdź oględziny',
    path: '/zatwierdz-wyceny',
    icon: 'checkmark-circle-outline',
    category: 'quotes',
    keywords: ['zatwierdź', 'akceptacja', 'wyceny', 'oględziny'],
    roles: [...MANAGEMENT_ROLES],
  },
  {
    id: 'inspections',
    label: 'Oględziny',
    path: '/ogledziny',
    icon: 'search-outline',
    category: 'quotes',
    keywords: ['oględziny', 'inspekcja', 'dokumentacja'],
    roles: ['Wyceniający', 'Brygadzista', ...MANAGEMENT_ROLES],
  },
  {
    id: 'fleet',
    label: 'Flota',
    path: '/flota-mobile',
    icon: 'car-outline',
    category: 'fleetMagazyn',
    keywords: ['flota', 'samochody', 'sprzęt'],
    roles: ['Magazynier', ...MANAGEMENT_ROLES],
  },
  {
    id: 'reservations',
    label: 'Rezerwacje sprzętu',
    path: '/rezerwacje-sprzetu',
    icon: 'calendar-number-outline',
    category: 'fleetMagazyn',
    keywords: ['rezerwacje', 'sprzęt', 'termin'],
    roles: ['Magazynier', ...MANAGEMENT_ROLES],
  },
  {
    id: 'warehouse',
    label: 'Magazyn',
    path: '/magazyn-mobile',
    icon: 'cube-outline',
    category: 'fleetMagazyn',
    keywords: ['magazyn', 'stany', 'materiały'],
    roles: ['Magazynier', ...MANAGEMENT_ROLES],
  },
  {
    id: 'calendar-blocks',
    label: 'Blokady kalendarza',
    path: '/blokady-kalendarza',
    icon: 'ban-outline',
    category: 'fleetMagazyn',
    keywords: ['blokady', 'kalendarz', 'niedostępność'],
    roles: ['Magazynier', ...MANAGEMENT_ROLES],
  },
  {
    id: 'crew-confirm',
    label: 'Potwierdzenia ekip',
    path: '/potwierdzenia-ekip',
    icon: 'people-circle-outline',
    category: 'fleetMagazyn',
    keywords: ['ekipy', 'potwierdzenia', 'obsada'],
    roles: ['Magazynier', ...MANAGEMENT_ROLES],
  },
  {
    id: 'mobile-reports',
    label: 'Raporty mobilne',
    path: '/raporty-mobilne',
    icon: 'bar-chart-outline',
    category: 'reports',
    keywords: ['raport', 'mobilne', 'kpi'],
    roles: [...MANAGEMENT_ROLES, 'Specjalista'],
  },
  {
    id: 'daily-report',
    label: 'Raport dzienny',
    path: '/raport-dzienny',
    icon: 'document-text-outline',
    category: 'reports',
    keywords: ['raport dzienny', 'dzień', 'ekipa'],
    roles: ['Brygadzista', ...MANAGEMENT_ROLES],
  },
  {
    id: 'kpi-week',
    label: 'KPI tygodnia',
    path: '/kpi-tydzien',
    icon: 'stats-chart-outline',
    category: 'reports',
    keywords: ['kpi', 'tydzień', 'analityka'],
    roles: ['Magazynier', ...MANAGEMENT_ROLES],
  },
  {
    id: 'settlements',
    label: 'Rozliczenia',
    path: '/rozliczenia',
    icon: 'wallet-outline',
    category: 'finance',
    keywords: ['rozliczenia', 'godziny', 'płatność'],
    roles: [...MANAGEMENT_ROLES, 'Brygadzista', 'Pomocnik', 'Specjalista'],
  },
  {
    id: 'estimator-finance',
    label: 'Wynagrodzenie za oględziny',
    path: '/wyceniajacy-finanse',
    icon: 'cash-outline',
    category: 'finance',
    keywords: ['wynagrodzenie', 'wyceniający', 'specjalista wyceny', 'oględziny', 'finanse'],
    roles: ['Wyceniający'],
  },
  {
    id: 'users',
    label: 'Użytkownicy',
    path: '/uzytkownicy-mobile',
    icon: 'people-outline',
    category: 'administration',
    keywords: ['użytkownicy', 'pracownicy', 'konto'],
    roles: MANAGEMENT_ROLES,
  },
  {
    id: 'branches',
    label: 'Oddziały',
    path: '/oddzialy-mobile',
    icon: 'business-outline',
    category: 'administration',
    keywords: ['oddziały', 'lokalizacja', 'filia'],
    roles: MANAGEMENT_ROLES,
  },
  {
    id: 'branch-features',
    label: 'Funkcje oddziałów',
    path: '/oddzial-funkcje-admin',
    icon: 'settings-outline',
    category: 'administration',
    keywords: ['funkcje', 'oddział', 'uprawnienia'],
    roles: MANAGEMENT_ROLES,
  },
  {
    id: 'crm-hub',
    label: 'CRM',
    path: '/crm-mobile',
    icon: 'git-network-outline',
    category: 'administration',
    keywords: ['crm', 'pipeline', 'leady', 'sales'],
    roles: MANAGEMENT_ROLES,
  },
  {
    id: 'crm-pipeline',
    label: 'Pipeline CRM',
    path: '/crm-pipeline-mobile',
    icon: 'funnel-outline',
    category: 'administration',
    keywords: ['pipeline', 'crm', 'lead', 'etapy', 'aktywnosci'],
    roles: MANAGEMENT_ROLES,
  },
  {
    id: 'clients',
    label: 'Klienci',
    path: '/klienci-mobile',
    icon: 'people-outline',
    category: 'administration',
    keywords: ['klienci', 'kontakt', 'firma', 'telefon'],
    roles: MANAGEMENT_ROLES,
  },
  {
    id: 'telephony',
    label: 'Telefonia',
    path: '/telefonia-mobile',
    icon: 'call-outline',
    category: 'administration',
    keywords: ['telefonia', 'polaczenia', 'sms', 'twilio'],
    roles: MANAGEMENT_ROLES,
  },
  {
    id: 'notifications',
    label: 'Powiadomienia',
    path: '/powiadomienia',
    icon: 'notifications-outline',
    category: 'account',
    keywords: ['powiadomienia', 'alert', 'komunikat'],
  },
  {
    id: 'profile',
    label: 'Profil',
    path: '/profil',
    icon: 'person-outline',
    category: 'account',
    keywords: ['profil', 'konto', 'ustawienia'],
  },
  {
    id: 'api-diagnostics',
    label: 'Diagnostyka API',
    path: '/api-diagnostyka',
    icon: 'pulse-outline',
    category: 'account',
    keywords: ['api', 'diagnostyka', 'test'],
  },
];

function isAllowedForRole(action: CommandAction, role?: string) {
  if (!action.roles || action.roles.length === 0) return true;
  if (!role) return false;
  return action.roles.includes(role);
}

export function getCommandCenterActionsForRole(role?: string): CommandAction[] {
  return ACTIONS.filter((action) => isAllowedForRole(action, role));
}

export function normalizeSearchValue(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function actionMatchesQuery(action: CommandAction, query: string): boolean {
  const q = normalizeSearchValue(query);
  if (!q) return true;
  const haystack = [
    action.label,
    action.path,
    ...action.keywords,
    ...CREW_ROLES,
    ...MANAGEMENT_ROLES,
  ]
    .map((v) => normalizeSearchValue(v))
    .join(' ');
  return haystack.includes(q);
}

