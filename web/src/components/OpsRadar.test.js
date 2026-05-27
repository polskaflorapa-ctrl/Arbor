import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import OpsRadar from './OpsRadar';

function renderRadar(props = {}) {
  const onOpenFilter = vi.fn();
  const onOpenPath = vi.fn();
  const onOpenTask = vi.fn();
  render(
    <OpsRadar
      tasks={[]}
      payrollClose={{ pending_count: 0 }}
      onOpenFilter={onOpenFilter}
      onOpenPath={onOpenPath}
      onOpenTask={onOpenTask}
      {...props}
    />
  );
  return { onOpenFilter, onOpenPath, onOpenTask };
}

test('shows all-clear actions when there are no open tasks', async () => {
  const { onOpenFilter, onOpenPath } = renderRadar({
    tasks: [
      { id: 1, status: 'Zakonczone', klient_nazwa: 'Dom Zielony' },
    ],
  });

  expect(screen.getByText(/operacyjnie/i)).toBeInTheDocument();
  expect(screen.getByText(/Wszystkie aktywne zlecenia.*domkni/i)).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: /Lista zlece/i }));
  expect(onOpenFilter).toHaveBeenCalledWith('');

  await userEvent.click(screen.getByRole('button', { name: /Raport dzienny/i }));
  expect(onOpenPath).toHaveBeenCalledWith('/raport-dzienny');
});

test('opens the task from the highest-priority decision row', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const overdue = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { onOpenTask } = renderRadar({
    tasks: [
      {
        id: 42,
        status: 'Do_Zatwierdzenia',
        klient_nazwa: 'Osiedle Lesne',
        data_planowana: overdue,
        wartosc_planowana: 18500,
      },
      {
        id: 43,
        status: 'Zaplanowane',
        klient_nazwa: 'Nowa Wycena',
        data_planowana: today,
        wartosc_planowana: 8000,
        ekipa_id: 7,
      },
    ],
  });

  await userEvent.click(screen.getByRole('button', { name: /#42 Osiedle Lesne/i }));
  expect(onOpenTask).toHaveBeenCalledWith(42);
});
