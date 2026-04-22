import './i18n';
import { render, screen } from '@testing-library/react';
import App from './App';

test('renders login screen by default', () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: /ARBOR-OS/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /zaloguj się/i })).toBeInTheDocument();
});

