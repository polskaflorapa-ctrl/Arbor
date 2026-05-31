import AsyncStorage from '@react-native-async-storage/async-storage';

export type AppErrorReportSource = 'error-boundary' | 'manual-test' | 'unknown';

export type AppErrorReport = {
  id: string;
  message: string;
  name?: string;
  stack?: string;
  componentStack?: string;
  createdAt: string;
  source: AppErrorReportSource;
  appRoute?: string;
};

export const APP_ERROR_REPORT_KEY = 'app_error_report_last_v1';

type SaveAppErrorReportInput = {
  message: string;
  name?: string;
  stack?: string;
  componentStack?: string;
  source?: AppErrorReportSource;
  appRoute?: string;
};

function makeReportId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function cleanText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export async function saveAppErrorReport(input: SaveAppErrorReportInput): Promise<AppErrorReport> {
  const report: AppErrorReport = {
    id: makeReportId(),
    message: cleanText(input.message) || 'Unknown app error',
    name: cleanText(input.name) || undefined,
    stack: cleanText(input.stack) || undefined,
    componentStack: cleanText(input.componentStack) || undefined,
    createdAt: new Date().toISOString(),
    source: input.source ?? 'unknown',
    appRoute: cleanText(input.appRoute) || undefined,
  };
  await AsyncStorage.setItem(APP_ERROR_REPORT_KEY, JSON.stringify(report));
  return report;
}

export async function getLastAppErrorReport(): Promise<AppErrorReport | null> {
  const raw = await AsyncStorage.getItem(APP_ERROR_REPORT_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<AppErrorReport>;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.message !== 'string') {
      return null;
    }
    return {
      id: typeof parsed.id === 'string' ? parsed.id : makeReportId(),
      message: parsed.message,
      name: typeof parsed.name === 'string' ? parsed.name : undefined,
      stack: typeof parsed.stack === 'string' ? parsed.stack : undefined,
      componentStack: typeof parsed.componentStack === 'string' ? parsed.componentStack : undefined,
      createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : new Date().toISOString(),
      source: parsed.source === 'error-boundary' || parsed.source === 'manual-test' || parsed.source === 'unknown'
        ? parsed.source
        : 'unknown',
      appRoute: typeof parsed.appRoute === 'string' ? parsed.appRoute : undefined,
    };
  } catch {
    return null;
  }
}

export async function clearLastAppErrorReport(): Promise<void> {
  await AsyncStorage.removeItem(APP_ERROR_REPORT_KEY);
}

export function formatAppErrorReport(report: AppErrorReport): string {
  return [
    'ARBOR mobile app error report',
    `ID: ${report.id}`,
    `Created: ${report.createdAt}`,
    `Source: ${report.source}`,
    report.appRoute ? `Route: ${report.appRoute}` : null,
    report.name ? `Name: ${report.name}` : null,
    `Message: ${report.message}`,
    report.stack ? `Stack:\n${report.stack}` : null,
    report.componentStack ? `Component stack:\n${report.componentStack}` : null,
  ].filter(Boolean).join('\n');
}
