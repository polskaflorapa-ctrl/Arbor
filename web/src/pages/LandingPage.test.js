import '../i18n';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import LandingPage from './LandingPage';

beforeEach(() => {
  localStorage.clear();
  global.fetch = vi.fn().mockResolvedValue({ ok: true });
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

async function fillDemoForm() {
  await act(async () => {
    await userEvent.type(screen.getByPlaceholderText('Jan Kowalski'), 'Anna Nowak');
    await userEvent.type(screen.getByPlaceholderText('jan@firma.pl'), 'anna@example.test');
    await userEvent.type(screen.getByPlaceholderText('Nazwa firmy'), 'Pilne Drzewa');
    await userEvent.type(screen.getByPlaceholderText('+48 600 000 000'), '+48 500 100 200');
    await userEvent.type(screen.getByPlaceholderText(/Dyspozytornia/i), 'CRM i dyspozytornia');
  });
}

async function submitDemoForm() {
  await act(async () => {
    await userEvent.click(screen.getByRole('button', { name: /Wy.*lij zg.*oszenie/i }));
  });
}

test('sends a public demo request to the API and confirms the lead was captured', async () => {
  render(<LandingPage />);

  await fillDemoForm();
  await submitDemoForm();

  await waitFor(() => {
    expect(global.fetch).toHaveBeenCalledWith('/api/demo-requests', expect.objectContaining({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    }));
  });
  expect(await screen.findByText(/Oddzwonimy z konkretnym planem rozmowy/i)).toBeInTheDocument();
  expect(screen.getByPlaceholderText('Jan Kowalski')).toHaveValue('');
});

test('keeps the landing form alive when API delivery fails and local backup is corrupted', async () => {
  localStorage.setItem('arbor-landing-demo-requests', '{broken');
  global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });
  render(<LandingPage />);

  await fillDemoForm();
  await submitDemoForm();

  expect(await screen.findByRole('alert')).toHaveTextContent(/Spr.*buj ponownie/i);
  expect(localStorage.getItem('arbor-landing-demo-requests')).toContain('Pilne Drzewa');
});

test('replays a locally saved failed demo request when the landing page opens again', async () => {
  localStorage.setItem('arbor-landing-demo-requests', JSON.stringify([{
    name: 'Anna Retry',
    email: 'retry@example.test',
    company: 'Odzyskany Lead',
    phone: '+48 500 200 300',
    message: 'API bylo chwilowo niedostepne.',
    source: 'landing-page',
    createdAt: '2026-06-18T08:00:00.000Z',
    deliveryError: 'Demo request failed with 503',
  }]));
  global.fetch = vi.fn().mockResolvedValue({ ok: true });

  render(<LandingPage />);

  await waitFor(() => {
    expect(global.fetch).toHaveBeenCalledWith('/api/demo-requests', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('Odzyskany Lead'),
    }));
  });
  expect(await screen.findByText(/Wyslalismy zalegle zgloszenie demo \(1\)/i)).toBeInTheDocument();
  const saved = JSON.parse(localStorage.getItem('arbor-landing-demo-requests'));
  expect(saved[0].retrySyncedAt).toBeTruthy();
  expect(saved[0]).not.toHaveProperty('deliveryError');
});

test('keeps a failed local demo request queued when replay still cannot reach the API', async () => {
  localStorage.setItem('arbor-landing-demo-requests', JSON.stringify([{
    name: 'Anna Retry',
    email: 'retry@example.test',
    company: 'Nadal Offline',
    createdAt: '2026-06-18T08:00:00.000Z',
    deliveryError: 'database down',
  }]));
  global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });

  render(<LandingPage />);

  await waitFor(() => {
    expect(global.fetch).toHaveBeenCalled();
  });
  const saved = JSON.parse(localStorage.getItem('arbor-landing-demo-requests'));
  expect(saved[0].deliveryError).toBe('database down');
  expect(saved[0].retryError).toBe('Demo request failed with 503');
  expect(saved[0].retrySyncedAt).toBeUndefined();
});
