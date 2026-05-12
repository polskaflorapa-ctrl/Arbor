/**
 * Dev panel for switching local test mode and mock users.
 * Hidden panel available with Ctrl+Shift+D / Cmd+Shift+D.
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
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        setIsOpen((open) => !open);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const reloadApp = () => {
    window.location.reload();
  };

  const handleTestModeToggle = () => {
    const newState = !testModeEnabled;
    toggleTestMode(newState);
    setTestModeEnabled(newState);

    if (newState) {
      const user = TEST_USERS[selectedUser];
      localStorage.setItem('token', 'test_token_' + Date.now());
      localStorage.setItem('user', JSON.stringify(user));
    } else {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    }

    reloadApp();
  };

  const handleUserChange = (role) => {
    setSelectedUser(role);
    if (!testModeEnabled) return;

    const user = TEST_USERS[role];
    localStorage.setItem('user', JSON.stringify(user));
    reloadApp();
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="dev-panel">
      <div className="dev-panel-content">
        <div className="dev-panel-header">
          <h3>Dev Panel</h3>
          <button
            className="dev-panel-close"
            onClick={() => setIsOpen(false)}
            aria-label="Zamknij"
          >
            x
          </button>
        </div>

        <div className="dev-panel-section">
          <label>
            <input
              type="checkbox"
              checked={testModeEnabled}
              onChange={handleTestModeToggle}
            />
            Wlacz tryb testowy
          </label>
          <p className="dev-panel-hint">
            {testModeEnabled ? 'Tryb testowy jest aktywny' : 'Tryb testowy jest wylaczony'}
          </p>
        </div>

        {testModeEnabled && (
          <div className="dev-panel-section">
            <label htmlFor="user-select">Testowy uzytkownik:</label>
            <select
              id="user-select"
              value={selectedUser}
              onChange={(e) => handleUserChange(e.target.value)}
            >
              <option value="dyrektor">Dyrektor</option>
              <option value="dyrektorSprzedazy">Dyrektor Sprzedazy</option>
              <option value="kierownik">Kierownik Oddzialu</option>
              <option value="specjalistaWroclaw">Specjalista Wroclaw</option>
              <option value="brygadzista">Brygadzista</option>
              <option value="wyceniajacy">Wyceniajacy</option>
            </select>
          </div>
        )}

        <div className="dev-panel-footer">
          <p>Otworz ponownie: Ctrl+Shift+D</p>
        </div>
      </div>
    </div>
  );
}
