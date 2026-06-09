import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Bell,
  CheckCircle2,
  Clipboard,
  Flame,
  Maximize2,
  MessageCircle,
  Minimize2,
  Pause,
  Play,
  RotateCcw,
  ShieldCheck,
  Share2,
  Sparkles,
  Target,
  Zap,
} from 'lucide-react';
import { Button } from '../components/ui/Button';
import './StreetThemeDemo.css';

const MODE_STORAGE_KEY = 'street-theme-mode';
const DONE_STORAGE_KEY = 'street-theme-done-drops';
const RUN_HISTORY_KEY = 'street-theme-run-history';
const INTENSITY_STORAGE_KEY = 'street-theme-intensity';
const MOTION_STORAGE_KEY = 'street-theme-reduced-motion';
const PRESET_QUERY_KEY = 'preset';

const intensities = {
  clean: {
    label: 'Clean',
    description: 'Mniej cienia, spokojniejsze krawedzie, nadal street.',
  },
  raw: {
    label: 'Raw',
    description: 'Balans demo: mocny plakat, ale czytelny produkt.',
  },
  chaos: {
    label: 'Chaos',
    description: 'Najglosniejszy wariant do moodboardu i prezentacji.',
  },
};

const beforeAfter = [
  ['CTA', 'Generic save button', 'Loud MagicPath action with icon'],
  ['Status', 'Flat text counters', 'Sticker stats with punchy color'],
  ['Flow', 'Read, decide later', 'Pick a tiny move and finish it'],
];

const missions = [
  { label: 'Daily check-in', value: '3/5', tone: 'hot' },
  { label: 'Crew support', value: '12', tone: 'lime' },
  { label: 'Real progress', value: '78%', tone: 'ink' },
];

const baseActions = [
  { title: 'Talk to someone', meta: '2 min response window', icon: MessageCircle },
  { title: 'Lock one goal', meta: 'Pick one thing for today', icon: Target },
  { title: 'Claim safe pass', meta: 'Help, map, quiet place', icon: ShieldCheck },
];

const modes = {
  grit: {
    label: 'Grit mode',
    title: 'Keep moving',
    cta: 'Claim next step',
    description: 'Ostre CTA, szybkie decyzje i energia jak z miejskiego plakatu.',
    missions,
    actions: baseActions,
    drops: ['Pick one hard thing', 'Send one honest message', 'Mark the win before midnight'],
    progress: 72,
  },
  calm: {
    label: 'Calm mode',
    title: 'Breathe first',
    cta: 'Find quiet help',
    description: 'Ten sam styl, ale mniej presji: wsparcie, spokojny rytm i bezpieczna akcja.',
    missions: [
      { label: 'Quiet minutes', value: '10', tone: 'ink' },
      { label: 'Support ping', value: 'ON', tone: 'lime' },
      { label: 'Pressure level', value: 'LOW', tone: 'hot' },
    ],
    actions: [
      { title: 'Slow the room', meta: 'One breath timer', icon: Sparkles },
      { title: 'Ask softly', meta: 'Send a no-pressure note', icon: MessageCircle },
      { title: 'Safe route', meta: 'Choose a quiet next place', icon: ShieldCheck },
    ],
    drops: ['Drink water', 'Mute one noisy thing', 'Take the smallest next step'],
    progress: 44,
  },
  crew: {
    label: 'Crew mode',
    title: 'No solo run',
    cta: 'Ping the crew',
    description: 'Wariant grupowy: kontakt, zadania zespolowe i szybka pomoc od ludzi.',
    missions: [
      { label: 'Crew online', value: '4', tone: 'lime' },
      { label: 'Open asks', value: '2', tone: 'hot' },
      { label: 'Done together', value: '9', tone: 'ink' },
    ],
    actions: [
      { title: 'Ping the crew', meta: 'Ask for backup', icon: MessageCircle },
      { title: 'Split the goal', meta: 'One task each', icon: Target },
      { title: 'Protect the plan', meta: 'Keep the group safe', icon: ShieldCheck },
    ],
    drops: ['Tag your backup person', 'Share the plan', 'Close one task together'],
    progress: 88,
  },
};

const quickPresets = [
  {
    name: 'Safe Start',
    mode: 'calm',
    intensity: 'clean',
    note: 'Low-pressure onboarding.',
  },
  {
    name: 'Crew Push',
    mode: 'crew',
    intensity: 'raw',
    note: 'Social help and team action.',
  },
  {
    name: 'Full Chaos',
    mode: 'grit',
    intensity: 'chaos',
    note: 'Maximum poster energy.',
  },
];

const proofSnapshots = [
  {
    name: 'Clean support',
    tag: 'low heat',
    mode: 'calm',
    intensity: 'clean',
    scene: 0,
    metric: 'quiet first',
    copy: 'Najbezpieczniejszy ekran do startu rozmowy.',
  },
  {
    name: 'Raw crew',
    tag: 'social proof',
    mode: 'crew',
    intensity: 'raw',
    scene: 1,
    metric: 'backup visible',
    copy: 'Wariant, gdzie nacisk zamienia sie w wsparcie ludzi.',
  },
  {
    name: 'Chaos action',
    tag: 'poster energy',
    mode: 'grit',
    intensity: 'chaos',
    scene: 2,
    metric: 'one loud CTA',
    copy: 'Najmocniejszy screen do pokazania charakteru.',
  },
];

const pitchScenes = [
  {
    label: 'Scene 1',
    title: 'Lower the pressure',
    mode: 'calm',
    intensity: 'clean',
    copy: 'Start with a safer tone for teens who need support, not noise.',
    metric: '10 quiet minutes',
    note: 'Open with safety: this is not a loud productivity app, it first lowers friction and makes the next step feel possible.',
  },
  {
    label: 'Scene 2',
    title: 'Bring the crew in',
    mode: 'crew',
    intensity: 'raw',
    copy: 'Shift from solo tasks into visible backup and shared action.',
    metric: '4 crew online',
    note: 'Then show the social layer: the UI turns personal pressure into shared support, with actions that make backup visible.',
  },
  {
    label: 'Scene 3',
    title: 'Turn it into motion',
    mode: 'grit',
    intensity: 'chaos',
    copy: 'Finish with high-energy CTA language and a clear next move.',
    metric: '100% action mood',
    note: 'Close with momentum: the street skin is loud, but every loud element still points to one concrete action.',
  },
];

const encodePresetForUrl = (preset) => btoa(preset).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const decodePresetFromUrl = (preset) => {
  const normalized = preset.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
  return atob(padded);
};

export default function StreetThemeDemo() {
  const [activeMode, setActiveMode] = useState(() => {
    if (typeof localStorage === 'undefined') return 'grit';
    const stored = localStorage.getItem(MODE_STORAGE_KEY);
    return modes[stored] ? stored : 'grit';
  });
  const [doneDrops, setDoneDrops] = useState(() => {
    if (typeof localStorage === 'undefined') return {};
    try {
      const parsed = JSON.parse(localStorage.getItem(DONE_STORAGE_KEY) || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  });
  const [runHistory, setRunHistory] = useState(() => {
    if (typeof localStorage === 'undefined') return [];
    try {
      const parsed = JSON.parse(localStorage.getItem(RUN_HISTORY_KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const [intensity, setIntensity] = useState(() => {
    if (typeof localStorage === 'undefined') return 'raw';
    const stored = localStorage.getItem(INTENSITY_STORAGE_KEY);
    return intensities[stored] ? stored : 'raw';
  });
  const [activeScene, setActiveScene] = useState(0);
  const [isAutoPitching, setIsAutoPitching] = useState(false);
  const [isStageMode, setIsStageMode] = useState(false);
  const [isReducedMotion, setIsReducedMotion] = useState(() => {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem(MOTION_STORAGE_KEY) === 'true';
  });
  const [presetText, setPresetText] = useState('');
  const [presetStatus, setPresetStatus] = useState('Ready to export.');
  const mode = modes[activeMode];
  const intensityMode = intensities[intensity];
  const completedCount = doneDrops[activeMode]?.length || 0;
  const computedProgress = Math.min(100, mode.progress + completedCount * 8);
  const allDropsDone = completedCount === mode.drops.length;

  useEffect(() => {
    try {
      localStorage.setItem(MODE_STORAGE_KEY, activeMode);
    } catch {
      // Demo-only persistence can safely fail in restricted browsers.
    }
  }, [activeMode]);

  useEffect(() => {
    try {
      localStorage.setItem(DONE_STORAGE_KEY, JSON.stringify(doneDrops));
    } catch {
      // Demo-only persistence can safely fail in restricted browsers.
    }
  }, [doneDrops]);

  useEffect(() => {
    try {
      localStorage.setItem(RUN_HISTORY_KEY, JSON.stringify(runHistory.slice(0, 8)));
    } catch {
      // Demo-only persistence can safely fail in restricted browsers.
    }
  }, [runHistory]);

  useEffect(() => {
    try {
      localStorage.setItem(INTENSITY_STORAGE_KEY, intensity);
    } catch {
      // Demo-only persistence can safely fail in restricted browsers.
    }
  }, [intensity]);

  useEffect(() => {
    try {
      localStorage.setItem(MOTION_STORAGE_KEY, String(isReducedMotion));
    } catch {
      // Demo-only persistence can safely fail in restricted browsers.
    }
    if (isReducedMotion) setIsAutoPitching(false);
  }, [isReducedMotion]);

  useEffect(() => {
    const presetParam = new URLSearchParams(window.location.hash.split('?')[1] || '').get(PRESET_QUERY_KEY);
    if (!presetParam) return;

    try {
      const parsed = JSON.parse(decodePresetFromUrl(presetParam));
      applyPreset(parsed, 'Preset loaded from link.');
    } catch {
      setPresetStatus('Preset link is broken.');
    }
  }, []);

  useEffect(() => {
    if (!isAutoPitching || isReducedMotion) return undefined;

    const timer = window.setInterval(() => {
      setActiveScene((current) => {
        const next = (current + 1) % pitchScenes.length;
        const scene = pitchScenes[next];
        applyPreset({
          mode: scene.mode,
          intensity: scene.intensity,
          doneDrops: {},
          runHistory: [],
        }, `Auto pitch: ${scene.label}.`);
        return next;
      });
    }, 2600);

    return () => window.clearInterval(timer);
  }, [isAutoPitching, isReducedMotion]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      const tagName = event.target?.tagName;
      if (tagName === 'TEXTAREA' || tagName === 'INPUT' || event.target?.isContentEditable) return;

      if (event.key === ' ') {
        event.preventDefault();
        setIsAutoPitching((current) => !current);
        return;
      }

      if (event.key.toLowerCase() === 's') {
        setIsStageMode((current) => !current);
        return;
      }

      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;

      event.preventDefault();
      setIsAutoPitching(false);
      setActiveScene((current) => {
        const direction = event.key === 'ArrowRight' ? 1 : -1;
        const next = (current + direction + pitchScenes.length) % pitchScenes.length;
        const scene = pitchScenes[next];
        applyPreset({
          mode: scene.mode,
          intensity: scene.intensity,
          doneDrops: {},
          runHistory: [],
        }, `${scene.label} loaded.`);
        return next;
      });
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const toggleDrop = (drop) => {
    setDoneDrops((prev) => {
      const current = new Set(prev[activeMode] || []);
      if (current.has(drop)) {
        current.delete(drop);
      } else {
        current.add(drop);
      }
      return { ...prev, [activeMode]: [...current] };
    });
  };

  const resetMode = () => {
    if (allDropsDone) {
      setRunHistory((prev) => [
        {
          mode: mode.label,
          title: mode.title,
          completedAt: new Date().toISOString(),
        },
        ...prev,
      ].slice(0, 8));
    }
    setDoneDrops((prev) => ({ ...prev, [activeMode]: [] }));
  };

  const buildPreset = () => JSON.stringify({
    version: 2,
    mode: activeMode,
    intensity,
    activeScene,
    isStageMode,
    isReducedMotion,
    doneDrops,
    runHistory: runHistory.slice(0, 8),
    exportedAt: new Date().toISOString(),
  }, null, 2);

  const buildSpeakerScript = () => pitchScenes.map((scene) => (
    `${scene.label}: ${scene.title}\n${scene.copy}\nPresenter note: ${scene.note}\nMetric: ${scene.metric}`
  )).join('\n\n');

  const buildCssTokens = () => {
    const shell = document.querySelector('.street-shell');
    const shellStyles = shell ? getComputedStyle(shell) : null;
    const readToken = (name, fallback) => shellStyles?.getPropertyValue(name).trim() || fallback;

    return [
    ':root {',
    '  --street-accent: #31f27b;',
    '  --street-ink: #06130d;',
    '  --street-paper: #f7fff9;',
    '  --street-warning: #fff35a;',
    `  --street-mode: ${activeMode};`,
    `  --street-intensity: ${intensity};`,
    `  --street-active-scene: ${activeScene + 1};`,
    `  --street-stage-mode: ${isStageMode ? 'on' : 'off'};`,
    `  --street-reduced-motion: ${isReducedMotion ? 'on' : 'off'};`,
    `  --street-card-shadow: ${readToken('--street-card-shadow', '8px 8px 0 #06130d')};`,
    `  --street-phone-shadow: ${readToken('--street-phone-shadow', '12px 12px 0 #06130d')};`,
    `  --street-border-width: ${readToken('--street-border-width', '3px')};`,
    '}',
    ].join('\n');
  };

  const applyPreset = (parsed, status) => {
    if (!modes[parsed.mode] || !intensities[parsed.intensity]) {
      setPresetStatus('Preset has unknown mode or intensity.');
      return;
    }
    const nextScene = Number.isInteger(parsed.activeScene) ? parsed.activeScene : 0;
    setActiveMode(parsed.mode);
    setIntensity(parsed.intensity);
    setActiveScene(Math.min(Math.max(nextScene, 0), pitchScenes.length - 1));
    setIsStageMode(Boolean(parsed.isStageMode));
    setIsReducedMotion(Boolean(parsed.isReducedMotion));
    setIsAutoPitching(false);
    setDoneDrops(parsed.doneDrops && typeof parsed.doneDrops === 'object' ? parsed.doneDrops : {});
    setRunHistory(Array.isArray(parsed.runHistory) ? parsed.runHistory.slice(0, 8) : []);
    setPresetStatus(status);
  };

  const exportPreset = async () => {
    const preset = buildPreset();
    setPresetText(preset);
    setPresetStatus('Preset exported.');
    try {
      await navigator.clipboard?.writeText(preset);
      setPresetStatus('Preset exported and copied.');
    } catch {
      setPresetStatus('Preset exported. Copy it manually.');
    }
  };

  const loadPreset = () => {
    try {
      const parsed = JSON.parse(presetText);
      applyPreset(parsed, 'Preset loaded.');
    } catch {
      setPresetStatus('Preset JSON is broken.');
    }
  };

  const loadQuickPreset = (preset) => {
    applyPreset({
      mode: preset.mode,
      intensity: preset.intensity,
      activeScene: 0,
      isStageMode: false,
      isReducedMotion: false,
      doneDrops: {},
      runHistory: [],
    }, `${preset.name} loaded.`);
    setPresetText(JSON.stringify({
      version: 2,
      mode: preset.mode,
      intensity: preset.intensity,
      activeScene: 0,
      isStageMode: false,
      isReducedMotion: false,
      doneDrops: {},
      runHistory: [],
      exportedAt: new Date().toISOString(),
    }, null, 2));
  };

  const loadPitchScene = (scene, index) => {
    setIsAutoPitching(false);
    setActiveScene(index);
    applyPreset({
      mode: scene.mode,
      intensity: scene.intensity,
      activeScene: index,
      isStageMode,
      isReducedMotion,
      doneDrops: {},
      runHistory: [],
    }, `${scene.label} loaded.`);
  };

  const loadProofSnapshot = (snapshot) => {
    setIsAutoPitching(false);
    applyPreset({
      version: 2,
      mode: snapshot.mode,
      intensity: snapshot.intensity,
      activeScene: snapshot.scene,
      isStageMode: false,
      isReducedMotion,
      doneDrops: {},
      runHistory: [],
      exportedAt: new Date().toISOString(),
    }, `${snapshot.name} snapshot loaded.`);
    setPresetText(JSON.stringify({
      version: 2,
      mode: snapshot.mode,
      intensity: snapshot.intensity,
      activeScene: snapshot.scene,
      isStageMode: false,
      isReducedMotion,
      doneDrops: {},
      runHistory: [],
      exportedAt: new Date().toISOString(),
    }, null, 2));
  };

  const copyShareLink = async () => {
    const link = `${window.location.origin}${window.location.pathname}${window.location.search}#/street-theme?${PRESET_QUERY_KEY}=${encodePresetForUrl(buildPreset())}`;
    setPresetText(link);
    setPresetStatus('Share link generated.');
    try {
      await navigator.clipboard?.writeText(link);
      setPresetStatus('Share link copied.');
    } catch {
      setPresetStatus('Share link generated. Copy it manually.');
    }
  };

  const exportSpeakerScript = async () => {
    const script = buildSpeakerScript();
    setPresetText(script);
    setPresetStatus('Speaker script exported.');
    try {
      await navigator.clipboard?.writeText(script);
      setPresetStatus('Speaker script copied.');
    } catch {
      setPresetStatus('Speaker script exported. Copy it manually.');
    }
  };

  const exportCssTokens = async () => {
    const tokens = buildCssTokens();
    setPresetText(tokens);
    setPresetStatus('CSS tokens exported.');
    try {
      await navigator.clipboard?.writeText(tokens);
      setPresetStatus('CSS tokens copied.');
    } catch {
      setPresetStatus('CSS tokens exported. Copy it manually.');
    }
  };

  return (
    <main className={`street-shell street-intensity-${intensity} ${isStageMode ? 'street-stage-mode' : ''} ${isReducedMotion ? 'street-reduced-motion' : ''}`}>
      <section className="street-hero" aria-labelledby="street-title">
        <div className="street-copy">
          <span className="street-stamp">ARBOR TEEN OPS</span>
          <h1 id="street-title">Street survival dashboard</h1>
          <p>
            Proof-of-concept skin dla nastolatkow: ostre CTA, naklejki-statusy,
            markerowy rytm i MagicPath Button jako glowny system akcji.
          </p>
          <div className="street-mode-picker" aria-label="Street theme mode">
            {Object.entries(modes).map(([key, item]) => (
              <Button
                key={key}
                variant={activeMode === key ? 'primary' : 'outline'}
                size="sm"
                onClick={() => setActiveMode(key)}
              >
                {item.label}
              </Button>
            ))}
          </div>
          <div className="street-intensity-control" aria-label="Street intensity">
            <span>Intensity</span>
            <div>
              {Object.entries(intensities).map(([key, item]) => (
                <Button
                  key={key}
                  variant={intensity === key ? 'primary' : 'ghost'}
                  size="sm"
                  onClick={() => setIntensity(key)}
                >
                  {item.label}
                </Button>
              ))}
            </div>
          </div>
          <div className="street-actions">
            <Button size="lg" leftIcon={Zap}>Start now</Button>
            <Button variant="outline" size="lg" leftIcon={Sparkles}>See missions</Button>
          </div>
          <p className="street-mode-note">{mode.description} {intensityMode.description}</p>
        </div>

        <div className="street-phone" aria-label="Street theme app preview">
          <div className="street-phone-top">
            <span>LIVE BOARD</span>
            <Bell size={18} />
          </div>
          <div className="street-score">
            <span>Today</span>
            <strong>{mode.title}</strong>
          </div>
          <div className="street-mission-list">
            {mode.missions.map((item) => (
              <div className={`street-mission street-mission-${item.tone}`} key={item.label}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>
          <Button fullWidth leftIcon={allDropsDone ? CheckCircle2 : Flame}>
            {allDropsDone ? 'Run complete' : mode.cta}
          </Button>
        </div>
      </section>

      <section className="street-pitch" aria-label="Presentation run">
        <div className="street-pitch-lead">
          <span className="street-stamp street-stamp-light">PITCH RUN</span>
          <h2>{pitchScenes[activeScene].title}</h2>
          <p>{pitchScenes[activeScene].copy}</p>
          <div className="street-pitch-controls">
            <Button
              size="sm"
              leftIcon={isAutoPitching ? Pause : Play}
              onClick={() => setIsAutoPitching((current) => !current)}
              disabled={isReducedMotion}
            >
              {isAutoPitching ? 'Pause pitch' : 'Auto pitch'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              leftIcon={isStageMode ? Minimize2 : Maximize2}
              onClick={() => setIsStageMode((current) => !current)}
            >
              {isStageMode ? 'Exit stage' : 'Stage mode'}
            </Button>
            <Button
              variant={isReducedMotion ? 'primary' : 'outline'}
              size="sm"
              leftIcon={ShieldCheck}
              onClick={() => setIsReducedMotion((current) => !current)}
            >
              Reduced motion
            </Button>
            <span>{isAutoPitching ? 'Running every 2.6s' : 'Manual mode'}</span>
          </div>
          <div
            className={`street-pitch-timer ${isAutoPitching ? 'street-pitch-timer-active' : ''}`}
            aria-hidden="true"
            key={`${activeScene}-${isAutoPitching}`}
          >
            <span />
          </div>
          <div className="street-shortcuts" aria-label="Presentation shortcuts">
            <kbd>Space</kbd>
            <span>auto</span>
            <kbd>S</kbd>
            <span>stage</span>
            <kbd>Left</kbd>
            <kbd>Right</kbd>
            <span>scenes</span>
          </div>
          <div className="street-speaker-note" aria-label="Speaker note">
            <strong>Speaker note</strong>
            <p>{pitchScenes[activeScene].note}</p>
          </div>
        </div>
        <div className="street-pitch-scenes">
          {pitchScenes.map((scene, index) => (
            <button
              type="button"
              className={activeScene === index ? 'street-pitch-active' : ''}
              key={scene.label}
              onClick={() => loadPitchScene(scene, index)}
            >
              <span>{scene.label}</span>
              <strong>{scene.title}</strong>
              <em>{scene.metric}</em>
            </button>
          ))}
        </div>
      </section>

      <section className="street-grid" aria-label="Street actions">
        {mode.actions.map(({ title, meta, icon: Icon }) => (
          <article className="street-card" key={title}>
            <div className="street-card-icon"><Icon size={20} /></div>
            <div>
              <h2>{title}</h2>
              <p>{meta}</p>
            </div>
            <Button variant="ghost" size="sm" rightIcon={ArrowRight}>Go</Button>
          </article>
        ))}
      </section>

      <section className="street-compare" aria-label="Before and after comparison">
        <div className="street-before">
          <span className="street-mini-label">OLD</span>
          <h2>Standard panel</h2>
          <div className="street-old-window">
            <div className="street-old-line" />
            <div className="street-old-line street-old-line-short" />
            <button type="button">Save</button>
          </div>
        </div>
        <div className="street-after">
          <span className="street-mini-label">NEW</span>
          <h2>Street action panel</h2>
          <div className="street-after-window">
            <strong>{mode.title}</strong>
            <span>{computedProgress}% live progress</span>
            <Button size="sm" leftIcon={Zap}>{mode.cta}</Button>
          </div>
        </div>
        <div className="street-diff-list">
          {beforeAfter.map(([name, oldValue, newValue]) => (
            <div className="street-diff" key={name}>
              <span>{name}</span>
              <p>{oldValue}</p>
              <strong>{newValue}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="street-proof-board" aria-label="Visual proof snapshots">
        <div className="street-proof-head">
          <span className="street-stamp street-stamp-light">SCREEN PROOF</span>
          <h2>Three looks, one system</h2>
        </div>
        <div className="street-proof-grid">
          {proofSnapshots.map((snapshot) => {
            const isActive = activeMode === snapshot.mode
              && intensity === snapshot.intensity
              && activeScene === snapshot.scene;
            return (
              <article
                className={`street-proof-card street-proof-${snapshot.intensity} ${isActive ? 'street-proof-active' : ''}`}
                key={snapshot.name}
              >
                <div className="street-proof-screen">
                  <span>{snapshot.tag}</span>
                  <strong>{modes[snapshot.mode].title}</strong>
                  <em>{snapshot.metric}</em>
                  <div>
                    <i />
                    <i />
                    <i />
                  </div>
                </div>
                <div className="street-proof-copy">
                  <h3>{snapshot.name}</h3>
                  <p>{snapshot.copy}</p>
                  <Button
                    variant={isActive ? 'primary' : 'outline'}
                    size="sm"
                    rightIcon={ArrowRight}
                    onClick={() => loadProofSnapshot(snapshot)}
                  >
                    {isActive ? 'Loaded' : 'Use snapshot'}
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="street-drops" aria-label="Next drops">
        <div className="street-drop-board">
          <div>
            <span className="street-stamp street-stamp-light">NEXT DROPS</span>
            <h2>{mode.label}: three tiny moves</h2>
            {allDropsDone && (
              <p className="street-complete-copy">
                Run zamkniety. Mozesz zostawic streak albo odpalic jeszcze raz.
              </p>
            )}
          </div>
          <div>
            <div className="street-progress-meta">
              <span>{completedCount}/{mode.drops.length} done</span>
              <Button variant="ghost" size="sm" leftIcon={RotateCcw} onClick={resetMode}>
                Reset
              </Button>
            </div>
            <div className="street-progress" aria-label={`Progress ${computedProgress}%`}>
              <span style={{ width: `${computedProgress}%` }} />
            </div>
          </div>
        </div>
        <div className="street-drop-list">
          {mode.drops.map((drop, index) => (
            <div className={`street-drop ${doneDrops[activeMode]?.includes(drop) ? 'street-drop-done' : ''}`} key={drop}>
              <span>{index + 1}</span>
              <strong>{drop}</strong>
              <Button
                variant={doneDrops[activeMode]?.includes(drop) ? 'secondary' : index === 0 ? 'primary' : 'outline'}
                size="sm"
                rightIcon={doneDrops[activeMode]?.includes(drop) ? CheckCircle2 : ArrowRight}
                onClick={() => toggleDrop(drop)}
              >
                {doneDrops[activeMode]?.includes(drop) ? 'Done' : 'Do it'}
              </Button>
            </div>
          ))}
        </div>
      </section>

      {allDropsDone && (
        <section className="street-complete" aria-label="Run complete">
          <div>
            <span className="street-stamp street-stamp-dark">RUN COMPLETE</span>
            <h2>{mode.title} landed.</h2>
          </div>
          <Button size="lg" leftIcon={RotateCcw} onClick={resetMode}>
            Run it again
          </Button>
        </section>
      )}

      <section className="street-history" aria-label="Run history">
        <div>
          <span className="street-stamp street-stamp-light">STREAK WALL</span>
          <h2>{runHistory.length} runs locked</h2>
        </div>
        <div className="street-history-list">
          {runHistory.length === 0 ? (
            <p>Finish a run and it lands here.</p>
          ) : (
            runHistory.slice(0, 4).map((run) => (
              <div className="street-history-item" key={`${run.completedAt}-${run.mode}`}>
                <strong>{run.mode}</strong>
                <span>{new Date(run.completedAt).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="street-preset" aria-label="Street preset exporter">
        <div>
          <span className="street-stamp street-stamp-light">PRESET LAB</span>
          <h2>Save this vibe.</h2>
          <p>{presetStatus}</p>
          <div className="street-quick-presets" aria-label="Quick presets">
            {quickPresets.map((preset) => (
              <button type="button" key={preset.name} onClick={() => loadQuickPreset(preset)}>
                <strong>{preset.name}</strong>
                <span>{preset.note}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="street-preset-tools">
          <textarea
            aria-label="Street preset JSON"
            value={presetText}
            onChange={(event) => setPresetText(event.target.value)}
            placeholder="Export a preset or paste one here."
          />
          <div className="street-preset-actions">
            <Button leftIcon={Clipboard} onClick={exportPreset}>
              Export preset
            </Button>
            <Button variant="secondary" leftIcon={Share2} onClick={copyShareLink}>
              Copy link
            </Button>
            <Button variant="outline" leftIcon={Sparkles} onClick={loadPreset}>
              Load preset
            </Button>
            <Button variant="ghost" leftIcon={MessageCircle} onClick={exportSpeakerScript}>
              Speaker script
            </Button>
            <Button variant="ghost" leftIcon={Sparkles} onClick={exportCssTokens}>
              CSS tokens
            </Button>
          </div>
        </div>
      </section>

      <section className="street-strip" aria-label="Status strip">
        <div>
          <span className="street-stamp street-stamp-dark">NO FAKE HYPE</span>
          <h2>Surowy klimat, ale UI nadal czytelne.</h2>
        </div>
        <div className="street-checks">
          <span><CheckCircle2 size={16} /> Accessible contrast</span>
          <span><CheckCircle2 size={16} /> Shared Button API</span>
          <span><CheckCircle2 size={16} /> Mobile-ready rhythm</span>
        </div>
      </section>
    </main>
  );
}
