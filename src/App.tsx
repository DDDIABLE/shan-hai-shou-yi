import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BeastBoard } from './components/BeastBoard';
import { KeyboardBoard } from './components/KeyboardBoard';
import { useAiWorker } from './hooks/useAiWorker';
import { GameAudio } from './audio';
import type { BeastScene } from './scene/BeastScene';
import {
  BEAST_NAMES,
  BEAST_TITLES,
  BEAST_TYPES,
  DIFFICULTY_CONFIG,
  INITIAL_SEED,
  SIDE_NAMES,
  applyMove,
  capturedPieces,
  createGame,
  describeResult,
  getLegalMoves,
  isWater,
  normalizeSeed,
  pieceAt,
  undo,
} from './engine/board';
import type {
  AiDifficulty,
  GameMode,
  GameState,
  Move,
  MoveEvent,
  Pos,
  Side,
} from './engine/types';

const SPEEDS = [0.5, 1, 2] as const;
const STORAGE_KEY = 'shan-hai-shou-yi-settings';

type PersistedSettings = {
  difficulty: AiDifficulty;
  humanSide: Side;
  watchSpeed: number;
  volume: number;
  muted: boolean;
  reducedMotion: boolean;
};

function loadSettings(): PersistedSettings {
  const fallback: PersistedSettings = {
    difficulty: 'normal',
    humanSide: 'teal',
    watchSpeed: 1,
    volume: 0.55,
    muted: false,
    reducedMotion: false,
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    return { ...fallback, ...(JSON.parse(raw) as Partial<PersistedSettings>) };
  } catch {
    return fallback;
  }
}

function saveSettings(settings: PersistedSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore
  }
}

function seedFromUrl(): number {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('seed');
  if (!raw) return INITIAL_SEED;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? normalizeSeed(parsed) : INITIAL_SEED;
}

function randomSeed(): number {
  return Math.floor(Math.random() * 900000) + 100000;
}

type Screen = 'menu' | 'game';

export default function App() {
  const initialSettings = useMemo(loadSettings, []);
  const [screen, setScreen] = useState<Screen>('menu');
  const [mode, setMode] = useState<GameMode>('watch');
  const [difficulty, setDifficulty] = useState<AiDifficulty>(initialSettings.difficulty);
  const [humanSide, setHumanSide] = useState<Side>(initialSettings.humanSide);
  const [speed, setSpeed] = useState<number>(initialSettings.watchSpeed);
  const [seedInput, setSeedInput] = useState<string>(String(INITIAL_SEED));
  const [seed, setSeed] = useState<number>(() => seedFromUrl());
  const [state, setState] = useState<GameState>(() => createGame({ mode: 'watch', seed: seedFromUrl() }));
  const [selected, setSelected] = useState<Pos | null>(null);
  const [lastEvent, setLastEvent] = useState<MoveEvent | null>(null);
  void lastEvent;
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(initialSettings.muted);
  const [volume, setVolume] = useState(initialSettings.volume);
  const [reducedMotion, setReducedMotion] = useState(initialSettings.reducedMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [showRules, setShowRules] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showKeyboard, setShowKeyboard] = useState(false);
  const [statusMessage, setStatusMessage] = useState('赤霞山先手');
  const [cameraInfo, setCameraInfo] = useState({ azimuth: 0, polar: 0, distance: 0 });
  const cameraInfoRef = useRef(cameraInfo);
  const sceneRef = useRef<BeastScene | null>(null);
  const stepRef = useRef<() => boolean>(() => false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.__shanHaiSceneRef = sceneRef;
    window.__shanHaiStep = () => stepRef.current();
  }, []);
  if (typeof window !== 'undefined') {
    window.__shanHaiCamera = cameraInfoRef.current;
  }
  const [pendingMode, setPendingMode] = useState<GameMode | null>(null);
  const audioRef = useRef<GameAudio | null>(null);
  const requestAi = useAiWorker();
  const aiInFlight = useRef(false);
  const stateRef = useRef(state);
  const pausedRef = useRef(paused);
  const speedRef = useRef(speed);
  stateRef.current = state;
  pausedRef.current = paused;
  speedRef.current = speed;

  if (!audioRef.current) {
    audioRef.current = new GameAudio();
  }
  const audio = audioRef.current;
  audio.setMuted(muted);
  audio.setVolume(volume);
  audio.persist();

  useEffect(() => {
    saveSettings({ difficulty, humanSide, watchSpeed: speed, volume, muted, reducedMotion });
  }, [difficulty, humanSide, speed, volume, muted, reducedMotion]);

  useEffect(() => {
    setState((current) => {
      if (current.result) return current;
      if (
        current.difficulty === difficulty &&
        current.mode === mode &&
        current.seed === seed &&
        (current.mode !== 'human-vs-ai' || current.humanSide === humanSide)
      ) {
        return current;
      }
      const next = structuredClone(current);
      next.difficulty = difficulty;
      next.mode = mode;
      next.seed = seed;
      if (mode === 'human-vs-ai') next.humanSide = humanSide;
      return next;
    });
  }, [difficulty, humanSide, mode, seed]);

  const startGame = useCallback(
    (nextMode: GameMode, nextSeed: number) => {
      const nextState = createGame({
        mode: nextMode,
        difficulty,
        humanSide: nextMode === 'human-vs-ai' ? humanSide : undefined,
        seed: nextSeed,
      });
      setState(nextState);
      setSelected(null);
      setLastEvent(null);
      setPaused(false);
      setShowKeyboard(false);
      setShowRules(false);
      setShowSettings(false);
      setScreen('game');
      setStatusMessage(`${SIDE_NAMES[nextState.turn]}先手`);
      audio.unlock();
      audio.play('drum');
    },
    [audio, difficulty, humanSide],
  );

  const restart = useCallback(() => {
    if (state.history.length > 0) {
      setPendingMode(mode);
      return;
    }
    startGame(mode, seed);
  }, [mode, seed, startGame, state.history.length]);

  const exitToMenu = useCallback(() => {
    setScreen('menu');
    setState(createGame({ mode: 'watch', seed }));
    setSelected(null);
    setLastEvent(null);
    setPaused(false);
    setShowKeyboard(false);
    setShowRules(false);
    setShowSettings(false);
  }, [seed]);

  const selectCell = useCallback(
    (pos: Pos) => {
      if (state.result) return;
      const current = stateRef.current;
      if (current.mode === 'human-vs-ai' && current.turn !== current.humanSide) return;
      if (selected) {
        const move = getLegalMoves(current, selected).find(
          (candidate) => candidate.to.x === pos.x && candidate.to.y === pos.y,
        );
        if (move) {
          const result = applyMove(current, move);
          setState(result.state);
          setLastEvent(result.event);
          setSelected(null);
          setStatusMessage(describeResult(result.state.result));
          audio.play(result.event.captured ? 'capture' : result.event.move.kind === 'jump' ? 'jump' : isWater(result.event.move.to) ? 'water' : 'place');
          if (result.event.trapApplied) audio.play('trap');
          if (result.event.result?.reason === 'den') {
            audio.play('den');
            setTimeout(() => audio.play('victory'), 500);
          }
          return;
        }
      }
      const piece = pieceAt(current.board, pos);
      if (piece && piece.side === current.turn) {
        setSelected(pos);
        audio.play('click');
        return;
      }
      setSelected(null);
    },
    [audio, selected, state.result],
  );

  const requestAiTurn = useCallback(
    async (currentState: GameState) => {
      if (currentState.result) return;
      if (aiInFlight.current) return;
      aiInFlight.current = true;
      let move: Move | null = null;
      try {
        move = await requestAi(currentState, currentState.difficulty, currentState.seed + currentState.ply * 131);
      } catch {
        move = null;
      } finally {
        aiInFlight.current = false;
      }
      if (!move) return;
      const latest = stateRef.current;
      if (latest.ply !== currentState.ply || latest.result) return;
      const result = applyMove(latest, move);
      setState(result.state);
      setLastEvent(result.event);
      setStatusMessage(describeResult(result.state.result));
      audio.play(result.event.captured ? 'capture' : result.event.move.kind === 'jump' ? 'jump' : isWater(result.event.move.to) ? 'water' : 'place');
      if (result.event.trapApplied) audio.play('trap');
      if (result.event.result?.reason === 'den') {
        audio.play('den');
        setTimeout(() => audio.play('victory'), 500);
      }
    },
    [audio, requestAi],
  );

  useEffect(() => {
    if (screen !== 'game' || state.result) return;
    if (state.mode === 'watch') {
      if (paused) return;
      const timer = setTimeout(() => {
        void requestAiTurn(stateRef.current);
      }, Math.max(180, 900 / speed));
      return () => clearTimeout(timer);
    }
    if (state.mode === 'human-vs-ai' && state.turn !== state.humanSide) {
      const timer = setTimeout(() => {
        void requestAiTurn(stateRef.current);
      }, 420);
      return () => clearTimeout(timer);
    }
  }, [screen, state, paused, speed, requestAiTurn]);

  stepRef.current = () => {
    if (aiInFlight.current) return false;
    void requestAiTurn(stateRef.current);
    return true;
  };

  const canUndo = state.history.length > 0 && !state.result;
  const handleUndo = useCallback(() => {
    if (!canUndo) return;
    aiInFlight.current = true;
    let plies = 1;
    if (state.mode === 'human-vs-ai') {
      const lastPlayerIndex = [...state.history].reverse().findIndex((entry) => entry.side === state.humanSide);
      if (lastPlayerIndex >= 0) {
        plies = lastPlayerIndex + 1;
        if (plies % 2 === 1 && plies < state.history.length) plies += 1;
      }
    }
    const restored = undo(state, Math.max(1, plies));
    setState(restored);
    setSelected(null);
    setLastEvent(null);
    setPaused(true);
    setStatusMessage(`已撤回 ${Math.max(1, plies)} 手`);
    audio.play('click');
    aiInFlight.current = false;
  }, [audio, canUndo, state]);

  const legalTargets = useMemo(() => {
    if (!selected) return [];
    return getLegalMoves(state, selected).map((move) => move.to);
  }, [selected, state]);

  const captured = useMemo(() => capturedPieces(state), [state]);
  const pieceCount = useMemo(() => {
    const count: Record<Side, number> = { crimson: 0, teal: 0 };
    for (const cell of state.board) if (cell.piece) count[cell.piece.side] += 1;
    return count;
  }, [state.board]);

  const confirmModeSwitch = () => {
    if (!pendingMode) return;
    setMode(pendingMode);
    startGame(pendingMode, seed);
    setPendingMode(null);
  };

  const enterGame = () => {
    const parsed = Number(seedInput);
    const nextSeed = Number.isFinite(parsed) ? normalizeSeed(parsed) : randomSeed();
    setSeed(nextSeed);
    setSeedInput(String(nextSeed));
    startGame(mode, nextSeed);
  };

  if (screen === 'menu') {
    return (
      <div className="menu-screen">
        <div className="menu-backdrop" aria-hidden="true">
          <div className="backdrop-mountain mountain-one" />
          <div className="backdrop-mountain mountain-two" />
          <div className="backdrop-mist" />
          <div className="backdrop-water" />
        </div>
        <main className="menu-content">
          <header className="brand-block">
            <div className="seal" aria-hidden="true">兽</div>
            <div className="brand-text">
              <span className="eyebrow">SHAN HAI JUNGLE</span>
              <h1>山海兽弈</h1>
              <p className="tagline">林深水阔，一子定山门。</p>
            </div>
          </header>

          <section className="menu-grid" aria-label="对局设置">
            <div className="mode-list">
              <h2><span className="section-index">01</span> 对局模式</h2>
              <button type="button" data-testid="mode-watch" className={`mode-card ${mode === 'watch' ? 'is-active' : ''}`} onClick={() => setMode('watch')}>
                <span className="mode-number">壹</span>
                <span><strong>观战 · AI 对 AI</strong><small>双方自动落子，可暂停与单步</small></span>
              </button>
              <button type="button" data-testid="mode-human" className={`mode-card ${mode === 'human-vs-ai' ? 'is-active' : ''}`} onClick={() => setMode('human-vs-ai')}>
                <span className="mode-number">贰</span>
                <span><strong>人机对战</strong><small>选择阵营，AI 自动回应</small></span>
              </button>
              <button type="button" data-testid="mode-local" className={`mode-card ${mode === 'local-pvp' ? 'is-active' : ''}`} onClick={() => setMode('local-pvp')}>
                <span className="mode-number">叁</span>
                <span><strong>本地双人</strong><small>同屏轮流落子</small></span>
              </button>
            </div>

            <div className="setup-list">
              <h2><span className="section-index">02</span> 棋力</h2>
              <div className="difficulty-row" role="radiogroup" aria-label="AI 难度">
                {(Object.keys(DIFFICULTY_CONFIG) as AiDifficulty[]).map((level) => (
                  <button
                    key={level}
                    type="button"
                    role="radio"
                    aria-checked={difficulty === level}
                    data-testid={`difficulty-${level}`}
                    className={`difficulty-button ${difficulty === level ? 'is-active' : ''}`}
                    onClick={() => setDifficulty(level)}
                  >
                    <strong>{DIFFICULTY_CONFIG[level].label}</strong>
                    <small>{level === 'easy' ? '初醒' : level === 'normal' ? '通幽' : '镇海'}</small>
                  </button>
                ))}
              </div>

              {mode === 'human-vs-ai' ? (
                <div className="side-select">
                  <h3>执子阵营</h3>
                  <div className="side-options">
                    <button type="button" data-testid="side-crimson" className={`side-button crimson ${humanSide === 'crimson' ? 'is-active' : ''}`} onClick={() => setHumanSide('crimson')}>
                      <span className="side-dot" />执赤霞山
                    </button>
                    <button type="button" data-testid="side-teal" className={`side-button teal ${humanSide === 'teal' ? 'is-active' : ''}`} onClick={() => setHumanSide('teal')}>
                      <span className="side-dot" />执苍岚泽
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="seed-row">
                <label htmlFor="seed">棋签种子</label>
                <div className="seed-controls">
                  <input
                    id="seed"
                    data-testid="seed-input"
                    value={seedInput}
                    inputMode="numeric"
                    onChange={(event) => setSeedInput(event.target.value.replace(/[^0-9]/g, ''))}
                    aria-describedby="seed-help"
                  />
                  <button type="button" data-testid="seed-shuffle" className="ghost-button" onClick={() => {
                    const next = randomSeed();
                    setSeedInput(String(next));
                    setSeed(next);
                  }}>
                    换签
                  </button>
                </div>
                <small id="seed-help">相同种子可复现同一局</small>
              </div>

              <button type="button" data-testid="enter-game" className="primary-button" onClick={enterGame}>
                入山海
                <span className="button-index">ENTER</span>
              </button>
              <p className="menu-hint">拖拽旋转视角，滚轮或双指缩放</p>
            </div>
          </section>
        </main>
        {pendingMode ? (
          <div className="confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
            <div className="confirm-card">
              <h2 id="confirm-title">切换模式？</h2>
              <p>切换后会从标准初始局面重开，当前对局不保留。</p>
              <div className="confirm-actions">
                <button type="button" className="ghost-button" onClick={() => setPendingMode(null)}>继续当前</button>
                <button type="button" className="primary-button" onClick={confirmModeSwitch}>重开</button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className={`game-screen ${showKeyboard ? 'show-keyboard' : ''}`}>
      <aside className="side-panel left-panel" aria-label="赤霞山状态">
        <div className="status-card crimson">
          <div className="status-card-head">
            <span className="side-dot" />
            <div>
              <strong>赤霞山</strong>
              <small>赤方</small>
            </div>
            <span className="piece-count">{pieceCount.crimson}</span>
          </div>
          <div className="captured-row" aria-label="赤方损失">
            {captured.crimson.length === 0 ? <span className="captured-empty">无失子</span> : captured.crimson.map((type, index) => (
              <span className="captured-chip" key={`${type}-${index}`}>{BEAST_NAMES[type]}</span>
            ))}
          </div>
        </div>
      </aside>

      <aside className="side-panel right-panel" aria-label="苍岚泽状态">
        <div className="status-card teal">
          <div className="status-card-head">
            <span className="side-dot" />
            <div>
              <strong>苍岚泽</strong>
              <small>青方</small>
            </div>
            <span className="piece-count">{pieceCount.teal}</span>
          </div>
          <div className="captured-row" aria-label="青方损失">
            {captured.teal.length === 0 ? <span className="captured-empty">无失子</span> : captured.teal.map((type, index) => (
              <span className="captured-chip" key={`${type}-${index}`}>{BEAST_NAMES[type]}</span>
            ))}
          </div>
        </div>
      </aside>

      {showRules || showSettings ? (
        <aside className="game-sidebar" data-testid="game-sidebar" aria-label="规则与设置侧栏">
          {showRules ? (
            <div className="sidebar-panel" role="dialog" aria-modal="false" aria-labelledby="rules-title">
              <div className="drawer-head">
                <h2 id="rules-title">规则与等级</h2>
                <button type="button" data-testid="close-rules" className="icon-button" onClick={() => setShowRules(false)} aria-label="关闭规则">×</button>
              </div>
              <div className="rules-body">
                <section>
                  <h3>等级</h3>
                  <ol className="rank-list">
                    {BEAST_TYPES.map((type) => (
                      <li key={type}><strong>{BEAST_NAMES[type]}</strong><span>{BEAST_TITLES[type]}</span></li>
                    ))}
                  </ol>
                </section>
                <section>
                  <h3>吃子</h3>
                  <p>攻击方等级大于等于防守方即可吃子。鼠可吃象，象不能吃鼠。同级互吃。</p>
                </section>
                <section>
                  <h3>水域</h3>
                  <p>只有鼠能入水。鼠进出水域那一步不能吃子。水中鼠只能被水中鼠吃。</p>
                </section>
                <section>
                  <h3>跃河</h3>
                  <p>狮虎可横竖跳过连续水域，落点为第一个陆地格。路径有鼠则不能跳。</p>
                </section>
                <section>
                  <h3>陷阱与兽穴</h3>
                  <p>敌兽进入对方陷阱后等级按 0 处理，离开恢复。进入对方兽穴立即获胜。</p>
                </section>
              </div>
            </div>
          ) : null}
          {showSettings ? (
            <div className="sidebar-panel" role="dialog" aria-modal="false" aria-labelledby="settings-title">
              <div className="drawer-head">
                <h2 id="settings-title">对局设置</h2>
                <button type="button" data-testid="close-settings" className="icon-button" onClick={() => setShowSettings(false)} aria-label="关闭设置">×</button>
              </div>
              <div className="settings-body">
                <label className="setting-row" data-testid="setting-difficulty-row">
                  <span>难度</span>
                  <select value={difficulty} onChange={(event) => setDifficulty(event.target.value as AiDifficulty)}>
                    <option value="easy">初醒</option>
                    <option value="normal">通幽</option>
                    <option value="hard">镇海</option>
                  </select>
                </label>
                {mode === 'human-vs-ai' ? (
                  <label className="setting-row">
                    <span>我的阵营</span>
                    <select value={humanSide} onChange={(event) => setHumanSide(event.target.value as Side)}>
                      <option value="crimson">赤霞山</option>
                      <option value="teal">苍岚泽</option>
                    </select>
                  </label>
                ) : null}
                <label className="setting-row">
                  <span>观战速度</span>
                  <select value={speed} onChange={(event) => setSpeed(Number(event.target.value))}>
                    <option value={0.5}>0.5×</option>
                    <option value={1}>1×</option>
                    <option value={2}>2×</option>
                  </select>
                </label>
                <label className="setting-row">
                  <span>音量</span>
                  <input type="range" min={0} max={1} step={0.05} value={volume} onChange={(event) => setVolume(Number(event.target.value))} />
                </label>
                <label className="setting-row" data-testid="setting-reduced-row">
                  <span>减少动态</span>
                  <input type="checkbox" checked={reducedMotion} onChange={(event) => setReducedMotion(event.target.checked)} />
                </label>
                <label className="setting-row checkbox-row">
                  <span>静音</span>
                  <input type="checkbox" checked={muted} onChange={(event) => setMuted(event.target.checked)} />
                </label>
                <div className="camera-readout" data-testid="camera-readout-drawer">
                  <span>镜头</span>
                  <small>方位 {cameraInfo.azimuth.toFixed(2)} · 俯仰 {cameraInfo.polar.toFixed(2)} · 距离 {cameraInfo.distance.toFixed(1)}</small>
                </div>
              </div>
            </div>
          ) : null}
        </aside>
      ) : null}

      <main className="game-main">
        <header className="game-topbar">
          <button type="button" data-testid="back-menu" className="icon-button" onClick={exitToMenu} aria-label="返回开局页">←</button>
          <div className="turn-block" data-testid="turn-block" aria-live="polite">
            <span className={`turn-chip ${state.turn}`}>{SIDE_NAMES[state.turn]}</span>
            <div>
              <strong>{statusMessage}</strong>
              <small>第 {state.ply} 手 · 无吃 {state.noCapturePlies}/100</small>
            </div>
          </div>
          <div className="topbar-actions">
            <span className="camera-readout-inline" data-testid="camera-readout">
              方位 {cameraInfo.azimuth.toFixed(2)} · 俯仰 {cameraInfo.polar.toFixed(2)} · 距离 {cameraInfo.distance.toFixed(1)}
            </span>
            <button type="button" data-testid="mute-toggle" className="icon-button" onClick={() => setMuted((value) => !value)} aria-label={muted ? '取消静音' : '静音'} aria-pressed={muted}>
              {muted ? '静' : '音'}
            </button>
            <button type="button" data-testid="open-rules" className="icon-button" onClick={() => setShowRules(true)} aria-label="规则与等级表">则</button>
            <button type="button" data-testid="open-settings" className="icon-button" onClick={() => setShowSettings(true)} aria-label="对局设置">设</button>
          </div>
        </header>

        <div className="board-area">
          <BeastBoard
            state={state}
            selected={selected}
            legalTargets={legalTargets}
            reducedMotion={reducedMotion}
            lastEvent={lastEvent}
            onCellClick={selectCell}
            sceneRef={sceneRef}
            onCameraChange={(azimuth, polar, distance) => {
              setCameraInfo({ azimuth, polar, distance });
              cameraInfoRef.current = { azimuth, polar, distance };
              window.__shanHaiCamera = { azimuth, polar, distance };
            }}
          />
          <KeyboardBoard state={state} selected={selected} legalTargets={legalTargets} onSelect={selectCell} />
        </div>

        <footer className="game-bottombar">
          <div className="bottom-action-group">
            <button type="button" data-testid="undo-button" className="tool-button" onClick={handleUndo} disabled={!canUndo}>撤回</button>
            <button type="button" data-testid="restart-button" className="tool-button" onClick={restart}>重开</button>
            <button type="button" data-testid="keyboard-toggle" className="tool-button" onClick={() => setShowKeyboard((value) => !value)} aria-expanded={showKeyboard}>键盘</button>
          </div>
          <div className="history-panel" aria-label="中文着法记录">
            <div className="history-head" data-testid="history-head">
              <span>棋谱</span>
              <small>种子 {state.seed}</small>
            </div>
            <div className="history-list">
              {state.history.length === 0 ? <span className="history-empty">尚未落子</span> : state.history.slice(-8).map((entry) => (
                <div className="history-entry" data-testid="history-entry" key={entry.ply}>
                  <span className="ply">{entry.ply}</span>
                  <span>{entry.notation}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="bottom-action-group watch-controls">
            {state.mode === 'watch' ? (
              <>
                <button type="button" data-testid="pause-toggle" className="tool-button" onClick={() => setPaused((value) => !value)}>
                  {paused ? '继续' : '暂停'}
                </button>
                <button type="button" data-testid="step-button" className="tool-button" disabled={!paused} onClick={() => {
                  setPaused(true);
                  void requestAiTurn(state);
                }}>单步</button>
                <div className="speed-group" aria-label="观战速度">
                  {SPEEDS.map((value) => (
                    <button key={value} type="button" data-testid={`speed-${value}`} className={`speed-button ${speed === value ? 'is-active' : ''}`} onClick={() => setSpeed(value)}>
                      {value}×
                    </button>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        </footer>
      </main>

      <div
        className="mobile-drawer"
        data-testid="drawer"
        aria-hidden={!showRules && !showSettings}
      >
        {showRules ? (
          <div className="drawer-panel" role="dialog" aria-modal="false" aria-labelledby="rules-title">
            <div className="drawer-head">
              <h2 id="rules-title">规则与等级</h2>
              <button type="button" data-testid="close-rules" className="icon-button" onClick={() => setShowRules(false)} aria-label="关闭规则">×</button>
            </div>
            <div className="rules-body">
              <section>
                <h3>等级</h3>
                <ol className="rank-list">
                  {BEAST_TYPES.map((type) => (
                    <li key={type}><strong>{BEAST_NAMES[type]}</strong><span>{BEAST_TITLES[type]}</span></li>
                  ))}
                </ol>
              </section>
              <section>
                <h3>吃子</h3>
                <p>攻击方等级大于等于防守方即可吃子。鼠可吃象，象不能吃鼠。同级互吃。</p>
              </section>
              <section>
                <h3>水域</h3>
                <p>只有鼠能入水。鼠进出水域那一步不能吃子。水中鼠只能被水中鼠吃。</p>
              </section>
              <section>
                <h3>跃河</h3>
                <p>狮虎可横竖跳过连续水域，落点为第一个陆地格。路径有鼠则不能跳。</p>
              </section>
              <section>
                <h3>陷阱与兽穴</h3>
                <p>敌兽进入对方陷阱后等级按 0 处理，离开恢复。进入对方兽穴立即获胜。</p>
              </section>
            </div>
          </div>
        ) : null}
        {showSettings ? (
          <div className="drawer-panel" role="dialog" aria-modal="false" aria-labelledby="settings-title">
            <div className="drawer-head">
              <h2 id="settings-title">对局设置</h2>
              <button type="button" data-testid="close-settings" className="icon-button" onClick={() => setShowSettings(false)} aria-label="关闭设置">×</button>
            </div>
            <div className="settings-body">
              <label className="setting-row" data-testid="setting-difficulty-row">
                <span>难度</span>
                <select value={difficulty} onChange={(event) => setDifficulty(event.target.value as AiDifficulty)}>
                  <option value="easy">初醒</option>
                  <option value="normal">通幽</option>
                  <option value="hard">镇海</option>
                </select>
              </label>
              {mode === 'human-vs-ai' ? (
                <label className="setting-row">
                  <span>我的阵营</span>
                  <select value={humanSide} onChange={(event) => setHumanSide(event.target.value as Side)}>
                    <option value="crimson">赤霞山</option>
                    <option value="teal">苍岚泽</option>
                  </select>
                </label>
              ) : null}
              <label className="setting-row">
                <span>观战速度</span>
                <select value={speed} onChange={(event) => setSpeed(Number(event.target.value))}>
                  <option value={0.5}>0.5×</option>
                  <option value={1}>1×</option>
                  <option value={2}>2×</option>
                </select>
              </label>
              <label className="setting-row">
                <span>音量</span>
                <input type="range" min={0} max={1} step={0.05} value={volume} onChange={(event) => setVolume(Number(event.target.value))} />
              </label>
              <label className="setting-row" data-testid="setting-reduced-row">
                <span>减少动态</span>
                <input type="checkbox" checked={reducedMotion} onChange={(event) => setReducedMotion(event.target.checked)} />
              </label>
              <label className="setting-row checkbox-row">
                <span>静音</span>
                <input type="checkbox" checked={muted} onChange={(event) => setMuted(event.target.checked)} />
              </label>
              <div className="camera-readout" data-testid="camera-readout-drawer">
                <span>镜头</span>
                <small>方位 {cameraInfo.azimuth.toFixed(2)} · 俯仰 {cameraInfo.polar.toFixed(2)} · 距离 {cameraInfo.distance.toFixed(1)}</small>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {state.result ? (
        <div className="result-overlay" role="dialog" aria-modal="true" aria-labelledby="result-title">
          <div className="result-card">
            <div className="result-seal" aria-hidden="true">{state.result.status === 'draw' ? '和' : '胜'}</div>
            <h2 id="result-title">{describeResult(state.result)}</h2>
            <p>{state.result.status === 'draw' ? '山水相逢，不分高下。' : `${SIDE_NAMES[state.result.winner ?? 'crimson']}踏入山门。`}</p>
            <div className="result-actions">
              <button type="button" className="ghost-button" onClick={exitToMenu}>回开局页</button>
              <button type="button" className="primary-button" onClick={restart}>再来一局</button>
            </div>
          </div>
        </div>
      ) : null}

      {pendingMode ? (
        <div className="confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
          <div className="confirm-card">
            <h2 id="confirm-title">切换模式？</h2>
            <p>切换后会从标准初始局面重开，当前对局不保留。</p>
            <div className="confirm-actions">
              <button type="button" className="ghost-button" onClick={() => setPendingMode(null)}>继续当前</button>
              <button type="button" className="primary-button" onClick={confirmModeSwitch}>重开</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
