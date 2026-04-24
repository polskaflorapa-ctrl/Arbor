import { useState, useEffect, useId } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../api';
import { getStoredToken } from '../utils/storedToken';
import { useNavigate } from 'react-router-dom';
import LanguageSwitcher from '../components/LanguageSwitcher';

export default function Login() {
  const { t } = useTranslation();
  const [login, setLogin] = useState('');
  const [haslo, setHaslo] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const navigate = useNavigate();
  const loginInputId = useId();
  const passwordInputId = useId();
  const rememberInputId = useId();

  useEffect(() => {
    if (getStoredToken()) navigate('/dashboard', { replace: true });
    const saved = localStorage.getItem('remembered_login');
    if (saved) { setLogin(saved); setRememberMe(true); }
  }, [navigate]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      const res = await api.post('/auth/login', { login, haslo });
      const tok = res.data?.token;
      if (tok != null && tok !== '') {
        localStorage.setItem('token', String(tok));
      } else {
        localStorage.removeItem('token');
      }
      if (res.data.user) {
        localStorage.setItem('user', JSON.stringify(res.data.user));
      } else {
        localStorage.removeItem('user');
      }
      if (rememberMe) localStorage.setItem('remembered_login', login);
      else localStorage.removeItem('remembered_login');
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(err.userMessage || err.response?.data?.error || t('login.invalidCredentials'));
      setHaslo('');
    } finally { setLoading(false); }
  };

  return (
    <div style={s.root}>
      {/* Tło z efektem */}
      <div style={s.bgGlow1} />
      <div style={s.bgGlow2} />

      <div style={s.card}>
        {/* Logo */}
        <div style={s.logoRow}>
          <div style={{ ...s.logoIcon, color: 'var(--accent)' }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22V12M12 12C12 7 7 3 3 3c0 4 2 8 5 10M12 12C12 7 17 3 21 3c0 4-2 8-5 10"/>
            </svg>
          </div>
          <h1 style={s.logoText}>ARBOR-OS</h1>
        </div>
        <p style={s.subtitle}>{t('login.subtitle')}</p>

        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
          <LanguageSwitcher />
        </div>

        <form onSubmit={handleLogin} style={s.form}>
          {/* Login */}
          <div style={s.field}>
            <label htmlFor={loginInputId} style={s.label}>{t('login.loginLabel')}</label>
            <div style={s.inputWrap}>
              <svg style={s.inputIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
              </svg>
              <input
                id={loginInputId}
                style={s.input}
                placeholder={t('login.placeholderLogin')}
                value={login} onChange={e => setLogin(e.target.value)}
                autoComplete="username"
                autoFocus
                required
              />
            </div>
          </div>

          {/* Hasło */}
          <div style={s.field}>
            <label htmlFor={passwordInputId} style={s.label}>{t('login.passwordLabel')}</label>
            <div style={s.inputWrap}>
              <svg style={s.inputIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round">
                <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
              <input
                id={passwordInputId}
                style={s.input}
                placeholder={t('login.placeholderPassword')}
                type={showPassword ? 'text' : 'password'}
                value={haslo} onChange={e => setHaslo(e.target.value)}
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                style={s.eyeBtn}
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? t('login.hidePassword') : t('login.showPassword')}
              >
                {showPassword
                  ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                  : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                }
              </button>
            </div>
          </div>

          {/* Opcje */}
          <div style={s.optRow}>
            <label htmlFor={rememberInputId} style={s.checkRow}>
              <input
                id={rememberInputId}
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                style={s.nativeCheckbox}
              />
              <span style={s.checkLabel}>{t('login.rememberMe')}</span>
            </label>
          </div>

          {error && (
            <div style={s.errBox}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              <span style={s.errText}>{error}</span>
            </div>
          )}

          <button
            style={{ ...s.btn, ...(loading ? { opacity: 0.7 } : {}) }}
            type="submit"
            disabled={loading || !login.trim() || !haslo.trim()}
          >
            {loading
              ? <span style={s.spinner} />
              : <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>
                  <span>{t('login.submit')}</span>
                </>
            }
          </button>
        </form>

        <p style={s.footer}>© {new Date().getFullYear()} ARBOR-OS</p>
      </div>
    </div>
  );
}

const s = {
  root: {
    minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'var(--bg)', position: 'relative', overflow: 'hidden', padding: 24,
  },
  bgGlow1: {
    position: 'absolute', top: -120, left: -120, width: 400, height: 400,
    borderRadius: '50%', background: 'var(--glow-accent)',
    pointerEvents: 'none',
  },
  bgGlow2: {
    position: 'absolute', bottom: -100, right: -100, width: 350, height: 350,
    borderRadius: '50%', background: 'var(--glow-secondary)',
    pointerEvents: 'none',
  },
  card: {
    background: 'var(--bg-card)', borderRadius: 20, padding: '40px 36px', width: '100%', maxWidth: 420,
    borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border)',
    boxShadow: 'var(--shadow-lg)',
    position: 'relative', zIndex: 1, animation: 'fadeInUp 0.4s ease',
  },
  logoRow: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginBottom: 8 },
  logoIcon: {
    width: 48, height: 48, borderRadius: 14, background: 'var(--logo-tint-bg)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--logo-tint-border)',
  },
  logoText: { margin: 0, fontSize: 26, fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.5px' },
  subtitle: { margin: '0 0 32px', fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' },
  form: { display: 'flex', flexDirection: 'column', gap: 18 },
  field: { display: 'flex', flexDirection: 'column', gap: 6 },
  label: { fontSize: 12, fontWeight: 600, color: 'var(--text-sub)', textTransform: 'uppercase', letterSpacing: '0.05em' },
  inputWrap: { position: 'relative', display: 'flex', alignItems: 'center' },
  inputIcon: { position: 'absolute', left: 12, pointerEvents: 'none' },
  input: {
    width: '100%', padding: '11px 12px 11px 40px', background: 'var(--bg-deep)',
    borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border)', borderRadius: 10, color: 'var(--text)', fontSize: 14,
    outline: 'none', transition: 'border-color 0.2s',
  },
  eyeBtn: {
    position: 'absolute', right: 10, background: 'none', border: 'none',
    cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center',
  },
  optRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  checkRow: { display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' },
  nativeCheckbox: {
    width: 16,
    height: 16,
    accentColor: 'var(--accent)',
    cursor: 'pointer',
  },
  checkLabel: { fontSize: 13, color: 'var(--text-sub)' },
  errBox: {
    display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(248,113,113,0.1)',
    border: '1px solid rgba(248,113,113,0.25)', borderRadius: 10, padding: '10px 14px',
  },
  errText: { fontSize: 13, color: 'var(--danger)', flex: 1 },
  btn: {
    padding: '13px', background: 'var(--accent)', color: 'var(--on-accent)', border: 'none', borderRadius: 10,
    fontSize: 14, fontWeight: 600, letterSpacing: '0.02em', cursor: 'pointer', display: 'flex', alignItems: 'center',
    justifyContent: 'center', gap: 8, transition: 'opacity 0.2s, filter 0.2s', marginTop: 4,
  },
  spinner: {
    width: 18, height: 18, border: '2px solid rgba(255,255,255,0.35)', borderTop: '2px solid var(--on-accent)',
    borderRadius: '50%', animation: 'spin 0.7s linear infinite', display: 'inline-block',
  },
  footer: { margin: '28px 0 0', fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' },
};
