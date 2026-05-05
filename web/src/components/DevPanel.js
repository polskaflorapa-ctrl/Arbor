/**
 * Dev panel dla włączania/wyłączania trybu testowego.
 * Ukryty panel dostępny pod kombinacją klawiszy Ctrl+Shift+D
 */
import React, { useState, useEffect } from 'react';
import { isTestModeEnabled, toggleTestMode, TEST_USERS } from '../utils/testMode';
import './DevPanel.css';

export function DevPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [testModeEnabled, setTestModeEnabled] = useState(false);
  const [selectedUser, setSelectedUser] = useState('dyrektor');

  useEffect(() => {
    setTestModeEnabled(isTestModeEnabled());
  }, []);

  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ctrl+Shift+D (lub Cmd+Shift+D na macOS)
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'd') {
        e.preventDefault();
        setIsOpen(!isOpen);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const handleTestModeToggle = () => {
    const newState = !testModeEnabled;
    toggleTestMode(newState);
    setTestModeEnabled(newState);
    if (newState) {
      // Zaloguj testowego użytkownika
      const user = TEST_USERS[selectedUser];
      localStorage.setItem('token', 'test_token_' + Date.now());
      localStorage.setItem('user', JSON.stringify(user));
      alert(`✓ Tryb testowy włączony\nRola: ${user.rola}`);
      window.location.reload();
    } else {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      alert('✗ Tryb testowy wyłączony');
      window.location.reload();
    }
  };

  const handleUserChange = (role) => {
    setSelectedUser(role);
    if (testModeEnabled) {
      const user = TEST_USERS[role];
      localStorage.setItem('user', JSON.stringify(user));
      alert(`✓ Zmieniono rolę na: ${user.rola}`);
      window.location.reload();
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="dev-panel">
      <div className="dev-panel-content">
        <div className="dev-panel-header">
          <h3>🛠️ Dev Panel</h3>
          <button
            className="dev-panel-close"
            onClick={() => setIsOpen(false)}
            aria-label="Zamknij"
          >
            ×
          </button>
        </div>

        <div className="dev-panel-section">
          <label>
            <input
              type="checkbox"
              checked={testModeEnabled}
              onChange={handleTestModeToggle}
            />
            Włącz tryb testowy
          </label>
          <p className="dev-panel-hint">
            {testModeEnabled
              ? '✓ Tryb testowy jest aktywny'
              : '✗ Tryb testowy jest wyłączony'}
          </p>
        </div>

        {testModeEnabled && (
          <div className="dev-panel-section">
            <label htmlFor="user-select">Testowy użytkownik:</label>
            <select
              id="user-select"
              value={selectedUser}
              onChange={(e) => handleUserChange(e.target.value)}
            >
              <option value="dyrektor">Dyrektor</option>
              <option value="kierownik">Kierownik Oddziału</option>
              <option value="brygadzista">Brygadzista</option>
              <option value="wyceniajacy">Wyceniający</option>
            </select>
          </div>
        )}

        <div className="dev-panel-footer">
          <p>Otwórz ponownie: Ctrl+Shift+D</p>
        </div>
      </div>
    </div>
  );
}
