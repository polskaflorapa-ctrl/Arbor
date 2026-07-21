import { useState, useEffect, useId } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../api';
import { clearAuthSession } from '../utils/authSession';
import { getStoredToken } from '../utils/storedToken';
import { useLocation, useNavigate } from 'react-router-dom';
import LanguageSwitcher from '../components/LanguageSwitcher';
import BrandLogo from '../components/BrandLogo';

const DEMO_ACCOUNTS = [
  { label: 'Dyrektor', login: 'dyrektor', haslo: 'ArborDemo2026!', color: '#f1f3d6' },
  { label: 'Kierownik oddziału', login: 'kierownik.waw', haslo: 'ArborDemo2026!', color: '#766440' },
  { label: 'Brygadzista', login: 'brygadzista.a1', haslo: 'ArborDemo2026!', color: '#bd701e' },
  { label: 'Pracownik', login: 'pracownik.a1', haslo: 'ArborDemo2026!', color: '#7f8c12' },
];

const SHOW_DEMO_ACCOUNTS =
  process.env.NODE_ENV !== 'production' || process.env.REACT_APP_SHOW_DEMO_LOGINS === '1';

const FRONTEND_ROLE_LABELS = {
  ADMINISTRATOR: 'Administrator',
  DYREKTOR: 'Dyrektor',
  KIEROWNIK: 'Kierownik',
  BRYGADZISTA: 'Brygadzista',
};

const normalizeUserForFrontend = (user = {}) => ({
  ...user,
  rola: FRONTEND_ROLE_LABELS[user.rola] || user.rola,
  oddzial_id: user.oddzial_id ?? user.branchId ?? null,
});

export default function Login() {
  const { t } = useTranslation();
  const [login, setLogin] = useState('');
  const [haslo, setHaslo] = useState('');
  const [forgotIdentifier, setForgotIdentifier] = useState('');
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotStatus, setForgotStatus] = useState('');
  const [forgotDevUrl, setForgotDevUrl] = useState('');
  const [resetHaslo, setResetHaslo] = useState('');
  const [resetConfirm, setResetConfirm] = useState('');
  const [resetStatus, setResetStatus] = useState('');
  const [resetComplete, setResetComplete] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo =
    typeof location.state?.from === 'string' && location.state.from.startsWith('/')
      ? location.state.from
      : '/dashboard';
  const resetToken = new URLSearchParams(location.search || '').get('resetToken') || '';
  const isResetMode = Boolean(resetToken) && !resetComplete;
  const loginInputId = useId();
  const passwordInputId = useId();
  const rememberInputId = useId();
  const forgotInputId = useId();
  const resetPasswordInputId = useId();
  const resetConfirmInputId = useId();

  useEffect(() => {
    if (getStoredToken()) navigate(returnTo, { replace: true });
    const saved = localStorage.getItem('remembered_login');
    if (saved) { setLogin(saved); setRememberMe(true); }
  }, [navigate, returnTo]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      const res = await api.post('/auth/login', { login, haslo });
      const tok = res.data?.token || res.data?.accessToken;
      const user = res.data?.user ? normalizeUserForFrontend(res.data.user) : null;
      const hasToken = tok != null && tok !== '';

      if (!hasToken || !user) {
        clearAuthSession();
        setError(t('login.invalidCredentials'));
        setHaslo('');
        setLoading(false);
        return;
      } else {
        localStorage.setItem('token', String(tok));
        if (res.data?.refreshToken) {
          localStorage.setItem('refreshToken', String(res.data.refreshToken));
        }
        localStorage.setItem('user', JSON.stringify(user));
        if (user.permissions) {
          localStorage.setItem('permissions', JSON.stringify(user.permissions));
        } else {
          localStorage.removeItem('permissions');
        }
      }
      if (rememberMe) localStorage.setItem('remembered_login', login);
      else localStorage.removeItem('remembered_login');
      setLoading(false);
      navigate(returnTo, { replace: true });
    } catch (err) {
      setError(err.userMessage || err.response?.data?.error || t('login.invalidCredentials'));
      setHaslo('');
      setLoading(false);
    }
  };

  const fillDemoAccount = (account) => {
    setLogin(account.login);
    setHaslo(account.haslo);
    setError('');
  };

  const handleForgotPassword = async (e) => {
    e?.preventDefault?.();
    setLoading(true);
    setError('');
    setForgotStatus('');
    setForgotDevUrl('');
    try {
      const res = await api.post('/auth/forgot-password', { identifier: forgotIdentifier.trim() });
      setForgotStatus(res.data?.message || 'Jeśli konto istnieje, wysłaliśmy link resetujący hasło.');
      if (res.data?.dev_reset_url) setForgotDevUrl(res.data.dev_reset_url);
    } catch (err) {
      setError(err.userMessage || err.response?.data?.error || 'Nie udało się wysłać linku resetującego.');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setResetStatus('');
    try {
      if (resetHaslo.length < 8) throw new Error('Hasło musi mieć co najmniej 8 znaków.');
      if (resetHaslo !== resetConfirm) throw new Error('Hasła muszą być takie same.');
      const res = await api.post('/auth/reset-password', { token: resetToken, haslo: resetHaslo });
      setResetStatus(res.data?.message || 'Hasło zostało zmienione. Możesz się zalogować.');
      setResetHaslo('');
      setResetConfirm('');
      setResetComplete(true);
      window.history.replaceState(null, '', `${window.location.origin}${window.location.pathname}#/login`);
    } catch (err) {
      setError(err.message || err.userMessage || err.response?.data?.error || 'Nie udało się zmienić hasła.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="login-shell" style={s.root}>
      {/* Tło z efektem */}
      <div className="login-glow login-glow-primary" style={s.bgGlow1} />
      <div className="login-glow login-glow-side" style={s.bgGlow2} />

      <section className="login-command-panel" style={s.commandPanel} aria-label="Polska Flora - panel operacyjny">
        <BrandLogo
          background="dark"
          withDescriptor
          className="login-command-logo"
          alt="Polska Flora — Nature Integrator"
        />
        <p style={s.commandCopy}>
          Operacyjny system dla zgłoszeń, bezpłatnych oględzin, ekip terenowych
          i usług pielęgnacji zieleni w Małopolsce.
        </p>
        <div style={s.featureList}>
          <div style={s.featureRow}><span className="login-feature-icon" style={s.featureIcon}>PF</span> Zgłoszenia z telefonu, CRM i formularzy</div>
          <div style={s.featureRow}><span className="login-feature-icon" style={s.featureIcon}>OG</span> Oględziny i trasy dla specjalistów</div>
          <div style={s.featureRow}><span className="login-feature-icon" style={s.featureIcon}>CRM</span> Pipeline, statusy i kontrola oddziału</div>
          <div style={s.featureRow}><span className="login-feature-icon" style={s.featureIcon}>AI</span> Telefonia z agentką Anią i SMS-ami</div>
        </div>
      </section>

      <div className="login-card" style={s.card}>
        <BrandLogo
          background="light"
          className="login-card-brand-logo"
          alt="Polska Flora"
        />
        <div className="login-logo-row" style={s.logoRow}>
          <h1 style={s.logoText}>Zaloguj się</h1>
        </div>
        <p style={s.subtitle}>Wprowadź dane dostępowe do systemu Polska Flora</p>

        <div className="login-language" style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
          <LanguageSwitcher />
        </div>

        {isResetMode ? (
          <form className="login-form" onSubmit={handleResetPassword} style={s.form}>
            <div style={s.resetIntro}>
              <strong>Ustaw nowe hasło</strong>
              <span>Wpisz nowe hasło dla konta Polska Flora.</span>
            </div>
            <div className="login-field" style={s.field}>
              <label htmlFor={resetPasswordInputId} style={s.label}>Nowe hasło</label>
              <div className="login-input-wrap" style={s.inputWrap}>
                <input
                  id={resetPasswordInputId}
                  style={{ ...s.input, paddingLeft: 14 }}
                  placeholder="Minimum 8 znaków"
                  type="password"
                  value={resetHaslo}
                  onChange={(e) => setResetHaslo(e.target.value)}
                  autoComplete="new-password"
                  required
                />
              </div>
            </div>
            <div className="login-field" style={s.field}>
              <label htmlFor={resetConfirmInputId} style={s.label}>Powtórz hasło</label>
              <div className="login-input-wrap" style={s.inputWrap}>
                <input
                  id={resetConfirmInputId}
                  style={{ ...s.input, paddingLeft: 14 }}
                  placeholder="Powtórz nowe hasło"
                  type="password"
                  value={resetConfirm}
                  onChange={(e) => setResetConfirm(e.target.value)}
                  autoComplete="new-password"
                  required
                />
              </div>
            </div>
            {resetStatus && <div style={s.okBox}>{resetStatus}</div>}
            {error && (
              <div className="login-error" style={s.errBox}>
                <span style={s.errText}>{error}</span>
              </div>
            )}
            <button
              className="login-submit"
              style={{ ...s.btn, ...(loading ? { opacity: 0.7 } : {}) }}
              type="submit"
              disabled={loading || !resetHaslo || !resetConfirm}
            >
              <span>{loading ? 'Zmieniam hasło...' : 'Zmień hasło'}</span>
            </button>
            <button className="login-link" type="button" style={s.linkBtn} onClick={() => navigate('/login', { replace: true })}>
              Wróć do logowania
            </button>
          </form>
        ) : (
          <>
        {SHOW_DEMO_ACCOUNTS && (
          <div className="login-demo-panel" style={s.demoPanel} aria-label="Konta demo">
            <div style={s.demoTitle}>Konta demonstracyjne (hasło: ArborDemo2026!)</div>
            <div style={s.demoGrid}>
              {DEMO_ACCOUNTS.map((account) => (
                <button
                  className="login-demo-btn"
                  key={account.login}
                  type="button"
                  style={s.demoBtn}
                  onClick={() => fillDemoAccount(account)}
                >
                  <span style={{ ...s.demoDot, background: account.color }} aria-hidden />
                  <span style={s.demoText}>
                    <span style={s.demoLogin}>{account.login}</span>
                    <span style={s.demoRole}>{account.label}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        <form className="login-form" onSubmit={handleLogin} style={s.form}>
          {/* Login */}
          <div className="login-field" style={s.field}>
            <label htmlFor={loginInputId} style={s.label}>{t('login.loginLabel')}</label>
            <div className="login-input-wrap" style={s.inputWrap}>
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

          {/* Haslo */}
          <div className="login-field" style={s.field}>
            <label htmlFor={passwordInputId} style={s.label}>{t('login.passwordLabel')}</label>
            <div className="login-input-wrap" style={s.inputWrap}>
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
                className="login-eye-toggle"
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
          <div className="login-options" style={s.optRow}>
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
            <button
              className="login-link"
              type="button"
              style={s.linkBtn}
              onClick={() => {
                setForgotOpen((value) => !value);
                setError('');
                setForgotStatus('');
                setResetStatus('');
              }}
            >
              Nie pamiętasz hasła?
            </button>
          </div>

          {forgotOpen && (
            <div style={s.forgotPanel}>
              <label htmlFor={forgotInputId} style={s.label}>Login albo e-mail</label>
              <div style={s.forgotForm}>
                <input
                  id={forgotInputId}
                  style={{ ...s.input, paddingLeft: 14 }}
                  placeholder="np. admin albo admin@polskaflora.local"
                  value={forgotIdentifier}
                  onChange={(e) => setForgotIdentifier(e.target.value)}
                  autoComplete="email"
                  required
                />
                <button type="button" style={s.smallBtn} onClick={handleForgotPassword} disabled={loading || !forgotIdentifier.trim()}>
                  Wyślij link
                </button>
              </div>
              {forgotStatus && <div style={s.okBox}>{forgotStatus}</div>}
              {forgotDevUrl && (
                <a style={s.devLink} href={forgotDevUrl}>
                  Otwórz link resetujący (dev)
                </a>
              )}
            </div>
          )}

          {resetStatus && <div style={s.okBox}>{resetStatus}</div>}

          {error && (
            <div className="login-error" style={s.errBox}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              <span style={s.errText}>{error}</span>
            </div>
          )}

          <button
            className="login-submit"
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
          </>
        )}

        <p style={s.footer}>&copy; {new Date().getFullYear()} Polska Flora</p>
      </div>
    </main>
  );
}

const s = {
  root: {
    minHeight: '100vh',
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) minmax(420px, 50vw)',
    alignItems: 'stretch',
    justifyContent: 'stretch',
    gap: 0,
    background: '#ffffff',
    position: 'relative', overflow: 'hidden', padding: 0,
  },
  bgGlow1: {
    position: 'absolute', inset: 0,
    background: 'linear-gradient(135deg, rgba(160,175,20,0.12), transparent 48%)',
    opacity: 0.55,
    pointerEvents: 'none',
  },
  bgGlow2: {
    position: 'absolute', top: 0, right: 0, width: '42%', height: '100%',
    background: 'linear-gradient(90deg, transparent 0%, rgba(189,112,30,0.1) 100%)',
    pointerEvents: 'none',
  },
  commandPanel: {
    position: 'relative',
    zIndex: 1,
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    borderRadius: 0,
    padding: '72px clamp(44px, 7vw, 92px)',
    color: '#ffffff',
    border: 'none',
    background:
      'linear-gradient(90deg, rgba(180,194,50,0.12) 1px, transparent 1px), linear-gradient(0deg, rgba(180,194,50,0.1) 1px, transparent 1px), #3b2a18',
    backgroundSize: '72px 72px, 72px 72px, auto',
    boxShadow: 'none',
    overflow: 'hidden',
  },
  commandBrandRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    marginBottom: 30,
  },
  commandLogoIcon: {
    width: 64,
    height: 64,
    borderRadius: 14,
    display: 'grid',
    placeItems: 'center',
    color: '#ffffff',
    background: 'linear-gradient(135deg, #7f8c12, #456b1f)',
    boxShadow: '0 22px 48px rgba(16,185,129,0.26)',
  },
  commandKicker: {
    color: '#e4efd6',
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: '0.32em',
    textTransform: 'uppercase',
    marginTop: 3,
  },
  commandTitle: {
    margin: 0,
    fontSize: 34,
    lineHeight: 1,
    fontWeight: 950,
    color: '#ffffff',
    letterSpacing: 0,
  },
  commandCopy: {
    maxWidth: 520,
    margin: '0 0 54px',
    color: 'rgba(248,250,252,0.92)',
    fontSize: 19,
    lineHeight: 1.55,
    fontWeight: 500,
  },
  featureList: {
    display: 'grid',
    gap: 26,
    maxWidth: 560,
  },
  featureRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    color: '#f0ebdd',
    fontSize: 16,
    fontWeight: 500,
  },
  featureIcon: {
    width: 34,
    height: 34,
    borderRadius: 9,
    display: 'inline-grid',
    placeItems: 'center',
    flex: '0 0 auto',
    fontSize: 17,
    background: 'rgba(16,185,129,0.22)',
    boxShadow: 'inset 0 0 0 1px rgba(16,185,129,0.18)',
  },
  commandMap: {
    position: 'absolute',
    right: -40,
    bottom: -42,
    width: 360,
    height: 240,
    borderRadius: 18,
    border: '1px solid rgba(134,239,172,0.2)',
    background: 'linear-gradient(90deg, rgba(134,239,172,0.13) 1px, transparent 1px), linear-gradient(0deg, rgba(134,239,172,0.1) 1px, transparent 1px), rgba(3,7,18,0.28)',
    backgroundSize: '32px 32px',
    transform: 'rotate(-4deg)',
  },
  mapPin: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: '50%',
    background: '#e4efd6',
    boxShadow: '0 0 0 8px rgba(134,239,172,0.16), 0 0 26px rgba(134,239,172,0.7)',
  },
  mapRoute: {
    position: 'absolute',
    left: '22%',
    top: '39%',
    width: '56%',
    height: '36%',
    borderTop: '2px dashed rgba(125,211,252,0.72)',
    borderRight: '2px dashed rgba(125,211,252,0.72)',
    borderRadius: 14,
  },
  card: {
    alignSelf: 'center',
    justifySelf: 'center',
    display: 'flex',
    flexDirection: 'column',
    background: '#ffffff',
    borderRadius: 0, padding: '40px 40px', width: 'min(100%, 528px)', maxWidth: 528,
    borderWidth: 0, borderStyle: 'solid', borderColor: 'transparent',
    boxShadow: 'none',
    position: 'relative', zIndex: 1, animation: 'fadeInUp 0.4s ease',
  },
  logoRow: { display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 12, marginBottom: 8 },
  logoIcon: {
    display: 'none',
    width: 48, height: 48, borderRadius: 14,
    background: 'var(--accent-gradient)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--logo-tint-border)',
    color: 'var(--on-accent)',
  },
  logoText: { margin: 0, fontSize: 26, fontWeight: 850, color: '#2c2011', letterSpacing: '0' },
  subtitle: { margin: '0 0 34px', fontSize: 16, color: '#8a8069', textAlign: 'left', lineHeight: 1.45 },
  demoPanel: {
    margin: '30px 0 0',
    padding: 16,
    borderRadius: 12,
    border: 'none',
    background: '#f0ebdd',
  },
  demoTitle: {
    marginBottom: 12,
    color: '#5a5040',
    fontSize: 12,
    fontWeight: 800,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  },
  demoGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 10,
  },
  demoBtn: {
    minWidth: 0,
    minHeight: 58,
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid #f0ebdd',
    background: '#ffffff',
    color: '#2c2011',
    cursor: 'pointer',
    textAlign: 'left',
  },
  demoDot: {
    width: 9,
    height: 9,
    borderRadius: '50%',
    flex: '0 0 auto',
    boxShadow: '0 0 0 4px rgba(15,23,42,0.04)',
  },
  demoText: {
    minWidth: 0,
    display: 'grid',
    gap: 2,
  },
  demoRole: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: 'var(--text-muted)',
    fontSize: 12,
    fontWeight: 700,
  },
  demoLogin: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 14,
    fontWeight: 850,
    color: '#5d6a0b',
  },
  form: { display: 'flex', flexDirection: 'column', gap: 18 },
  field: { display: 'flex', flexDirection: 'column', gap: 6 },
  label: { fontSize: 14, fontWeight: 750, color: '#5d6a0b', textTransform: 'none', letterSpacing: 0 },
  inputWrap: { position: 'relative', display: 'flex', alignItems: 'center' },
  inputIcon: { position: 'absolute', left: 12, pointerEvents: 'none' },
  input: {
    width: '100%', minHeight: 50, padding: '0 44px 0 40px', background: '#f0ebdd',
    borderWidth: 1, borderStyle: 'solid', borderColor: '#f0ebdd', borderRadius: 12, color: '#5d6a0b', fontSize: 16,
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
  linkBtn: {
    border: 0,
    background: 'transparent',
    color: 'var(--accent)',
    fontSize: 13,
    fontWeight: 800,
    cursor: 'pointer',
    padding: 0,
  },
  forgotPanel: {
    padding: 12,
    borderRadius: 10,
    border: '1px solid var(--border)',
    background: 'rgba(255,255,255,0.72)',
  },
  forgotForm: {
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    gap: 8,
    marginTop: 8,
  },
  smallBtn: {
    border: '1px solid var(--accent)',
    borderRadius: 8,
    background: 'var(--accent)',
    color: 'var(--on-accent)',
    fontWeight: 800,
    padding: '0 12px',
    cursor: 'pointer',
    minHeight: 44,
  },
  okBox: {
    padding: '10px 12px',
    borderRadius: 10,
    background: 'rgba(20, 131, 79, 0.1)',
    color: 'var(--accent-strong)',
    fontSize: 13,
    lineHeight: 1.45,
  },
  devLink: {
    display: 'inline-block',
    color: 'var(--accent)',
    fontSize: 13,
    fontWeight: 800,
    marginTop: 8,
  },
  resetIntro: {
    display: 'grid',
    gap: 4,
    padding: 12,
    borderRadius: 10,
    background: 'rgba(20, 131, 79, 0.08)',
    color: 'var(--text)',
  },
  errBox: {
    display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(248,113,113,0.1)',
    border: '1px solid rgba(248,113,113,0.25)', borderRadius: 10, padding: '10px 14px',
  },
  errText: { fontSize: 13, color: 'var(--danger)', flex: 1 },
  btn: {
    minHeight: 48,
    padding: '13px', background: 'linear-gradient(135deg, #7f8c12, #456b1f)', color: '#ffffff', border: 'none', borderRadius: 10,
    fontSize: 15, fontWeight: 800, letterSpacing: 0, cursor: 'pointer', display: 'flex', alignItems: 'center',
    justifyContent: 'center', gap: 8, transition: 'opacity 0.2s, filter 0.2s', marginTop: 4,
  },
  spinner: {
    width: 18, height: 18, border: '2px solid rgba(255,255,255,0.35)', borderTop: '2px solid var(--on-accent)',
    borderRadius: '50%', animation: 'spin 0.7s linear infinite', display: 'inline-block',
  },
  footer: { display: 'none', margin: '28px 0 0', fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' },
};
