import type {
  AiDifficulty,
  BeastType,
  Cell,
  GameMode,
  GameResult,
  GameState,
  HistoryEntry,
  Move,
  MoveEvent,
  Piece,
  Pos,
  Side,
} from './types';

export const COLS = 7;
export const ROWS = 9;
export const INITIAL_SEED = 20261102;

export const BEAST_TYPES: BeastType[] = [
  'rat',
  'cat',
  'dog',
  'wolf',
  'leopard',
  'tiger',
  'lion',
  'elephant',
];

export const BEAST_NAMES: Record<BeastType, string> = {
  rat: '鼠',
  cat: '猫',
  dog: '狗',
  wolf: '狼',
  leopard: '豹',
  tiger: '虎',
  lion: '狮',
  elephant: '象',
};

export const BEAST_TITLES: Record<BeastType, string> = {
  rat: '水泽斥候',
  cat: '轻灵刃客',
  dog: '圆盾忠卫',
  wolf: '月牙猎手',
  leopard: '斑影双刃',
  tiger: '云纹虎将',
  lion: '金鬃首领',
  elephant: '大耳山灵',
};

export const BEAST_VALUES: Record<BeastType, number> = {
  rat: 100,
  cat: 230,
  dog: 300,
  wolf: 380,
  leopard: 480,
  tiger: 620,
  lion: 760,
  elephant: 900,
};

const RANK: Record<BeastType, number> = {
  rat: 1,
  cat: 2,
  dog: 3,
  wolf: 4,
  leopard: 5,
  tiger: 6,
  lion: 7,
  elephant: 8,
};

const TEAL_SETUP: Array<[BeastType, number, number]> = [
  ['lion', 0, 0],
  ['tiger', 6, 0],
  ['dog', 1, 1],
  ['cat', 5, 1],
  ['rat', 0, 2],
  ['leopard', 2, 2],
  ['wolf', 4, 2],
  ['elephant', 6, 2],
];

export const DIFFICULTY_CONFIG: Record<
  AiDifficulty,
  { maxDepth: number; nodeBudget: number; label: string }
> = {
  easy: { maxDepth: 1, nodeBudget: 1500, label: '初醒' },
  normal: { maxDepth: 3, nodeBudget: 9000, label: '通幽' },
  hard: { maxDepth: 5, nodeBudget: 16000, label: '镇海' },
};

export const SIDE_NAMES: Record<Side, string> = {
  crimson: '赤霞山',
  teal: '苍岚泽',
};

export const SIDE_SHORT: Record<Side, string> = {
  crimson: '赤',
  teal: '苍',
};

export const SIDE_COLORS: Record<Side, string> = {
  crimson: '#c8513f',
  teal: '#4f9d8b',
};

export function otherSide(side: Side): Side {
  return side === 'crimson' ? 'teal' : 'crimson';
}

export function inBounds(pos: Pos): boolean {
  return pos.x >= 0 && pos.x < COLS && pos.y >= 0 && pos.y < ROWS;
}

export function cellIndex(pos: Pos): number {
  return pos.y * COLS + pos.x;
}

export function samePos(a: Pos, b: Pos): boolean {
  return a.x === b.x && a.y === b.y;
}

export function getCell(board: Cell[], pos: Pos): Cell | null {
  return inBounds(pos) ? board[cellIndex(pos)] : null;
}

export function pieceAt(board: Cell[], pos: Pos): Piece | null {
  const cell = getCell(board, pos);
  return cell ? cell.piece : null;
}

export function isWater(pos: Pos): boolean {
  return pos.y >= 3 && pos.y <= 5 && (pos.x >= 1 && pos.x <= 2 || pos.x >= 4 && pos.x <= 5);
}

export function isOwnDen(side: Side, pos: Pos): boolean {
  return samePos(pos, side === 'teal' ? { x: 3, y: 0 } : { x: 3, y: 8 });
}

export function isEnemyDen(side: Side, pos: Pos): boolean {
  return samePos(pos, side === 'teal' ? { x: 3, y: 8 } : { x: 3, y: 0 });
}

export function enemyDenOf(side: Side): Pos {
  return side === 'teal' ? { x: 3, y: 8 } : { x: 3, y: 0 };
}

export function ownDenOf(side: Side): Pos {
  return side === 'teal' ? { x: 3, y: 0 } : { x: 3, y: 8 };
}

export function isOwnTrap(side: Side, pos: Pos): boolean {
  const traps = side === 'teal'
    ? [{ x: 2, y: 0 }, { x: 4, y: 0 }, { x: 3, y: 1 }]
    : [{ x: 2, y: 8 }, { x: 4, y: 8 }, { x: 3, y: 7 }];
  return traps.some((trap) => samePos(trap, pos));
}

export function isEnemyTrap(side: Side, pos: Pos): boolean {
  return isOwnTrap(otherSide(side), pos);
}

export function effectiveRank(piece: Piece, pos: Pos): number {
  if (isEnemyTrap(piece.side, pos)) return 0;
  return RANK[piece.type];
}

export function createInitialBoard(): Cell[] {
  const board: Cell[] = Array.from({ length: COLS * ROWS }, () => ({ piece: null }));
  for (const [type, x, y] of TEAL_SETUP) {
    board[cellIndex({ x, y })].piece = { id: `teal-${type}`, type, side: 'teal' };
    const mirrored: Pos = { x: COLS - 1 - x, y: ROWS - 1 - y };
    board[cellIndex(mirrored)].piece = {
      id: `crimson-${type}`,
      type,
      side: 'crimson',
    };
  }
  return board;
}

export function createGame(options: {
  mode?: GameMode;
  difficulty?: AiDifficulty;
  humanSide?: Side;
  seed?: number;
} = {}): GameState {
  const board = createInitialBoard();
  const state: GameState = {
    version: 1,
    board,
    turn: 'crimson',
    mode: options.mode ?? 'watch',
    difficulty: options.difficulty ?? 'normal',
    humanSide: options.humanSide,
    seed: normalizeSeed(options.seed ?? INITIAL_SEED),
    ply: 0,
    noCapturePlies: 0,
    positionCounts: {},
    result: null,
    history: [],
  };
  state.positionCounts = { [hashPosition(state.board, state.turn)]: 1 };
  return state;
}

export function normalizeSeed(seed: number): number {
  if (!Number.isFinite(seed)) return INITIAL_SEED;
  return Math.abs(Math.trunc(seed)) % 0xffffffff;
}

function orthogonalNeighbors(pos: Pos): Pos[] {
  const candidates: Pos[] = [
    { x: pos.x + 1, y: pos.y },
    { x: pos.x - 1, y: pos.y },
    { x: pos.x, y: pos.y + 1 },
    { x: pos.x, y: pos.y - 1 },
  ];
  return candidates.filter(inBounds);
}

function capturesAllowed(
  mover: Piece,
  from: Pos,
  to: Pos,
  defender: Piece | null,
): boolean {
  if (!defender || defender.side === mover.side) return true;
  const moverInWater = isWater(from);
  const moverToWater = isWater(to);
  if (mover.type === 'rat' && (moverInWater !== moverToWater)) return false;
  if (moverInWater || moverToWater) {
    if (mover.type !== 'rat' && defender.type !== 'rat') return true;
    return mover.type === 'rat' && defender.type === 'rat' && moverToWater;
  }
  const attackerRank = effectiveRank(mover, to);
  const defenderRank = effectiveRank(defender, to);
  if (attackerRank === 0) return false;
  if (mover.type === 'rat' && defender.type === 'elephant') return true;
  if (mover.type === 'elephant' && defender.type === 'rat') return false;
  if (mover.type === 'rat' && defender.type === 'rat') return true;
  return attackerRank >= defenderRank;
}

function jumpPath(
  board: Cell[],
  from: Pos,
  to: Pos,
): { path: Pos[]; blockedByRat: boolean } | null {
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  if (dx !== 0 && dy !== 0) return null;
  const path: Pos[] = [];
  let cursor = { x: from.x + dx, y: from.y + dy };
  let blockedByRat = false;
  while (inBounds(cursor) && !samePos(cursor, to)) {
    path.push({ ...cursor });
    const occupant = pieceAt(board, cursor);
    if (occupant) {
      if (occupant.type === 'rat') blockedByRat = true;
      return { path, blockedByRat };
    }
    cursor = { x: cursor.x + dx, y: cursor.y + dy };
  }
  if (!samePos(cursor, to)) return null;
  return { path, blockedByRat };
}

function isLionTigerJump(board: Cell[], mover: Piece, from: Pos, to: Pos): boolean {
  if (mover.type !== 'lion' && mover.type !== 'tiger') return false;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx !== 0 && dy !== 0) return false;
  if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) return false;
  const result = jumpPath(board, from, to);
  if (!result) return false;
  if (result.blockedByRat) return false;
  if (result.path.length === 0) return false;
  if (!result.path.every(isWater)) return false;
  if (isWater(to)) return false;
  return true;
}

function moveKind(from: Pos, to: Pos): Move['kind'] {
  if (isWater(from) || isWater(to)) return 'water-step';
  if (from.x !== to.x && from.y !== to.y) return 'jump';
  const distance = Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
  if (distance > 1) return 'jump';
  return 'step';
}

export function getLegalMoves(state: GameState, from?: Pos): Move[] {
  if (state.result) return [];
  const board = state.board;
  const moves: Move[] = [];
  const sources: Pos[] = [];
  if (from) {
    const piece = pieceAt(board, from);
    if (piece && piece.side === state.turn) sources.push(from);
  } else {
    for (let y = 0; y < ROWS; y += 1) {
      for (let x = 0; x < COLS; x += 1) {
        const piece = pieceAt(board, { x, y });
        if (piece && piece.side === state.turn) sources.push({ x, y });
      }
    }
  }

  for (const source of sources) {
    const piece = pieceAt(board, source);
    if (!piece || piece.side !== state.turn) continue;
    const candidates = orthogonalNeighbors(source);
    for (const target of candidates) {
      const occupant = pieceAt(board, target);
      if (occupant && occupant.side === piece.side) continue;
      if (isOwnDen(piece.side, target)) continue;
      if (isWater(target) && piece.type !== 'rat') continue;
      if (!capturesAllowed(piece, source, target, occupant)) continue;
      const kind = moveKind(source, target);
      moves.push({
        from: { ...source },
        to: { ...target },
        kind,
        capturedId: occupant?.id,
        path: kind === 'jump' ? [source, target] : undefined,
      });
    }

    if (piece.type === 'lion' || piece.type === 'tiger') {
      for (let y = 0; y < ROWS; y += 1) {
        for (let x = 0; x < COLS; x += 1) {
          const target = { x, y };
          if (samePos(target, source)) continue;
          if (!isLionTigerJump(board, piece, source, target)) continue;
          const occupant = pieceAt(board, target);
          if (occupant && occupant.side === piece.side) continue;
          if (isOwnDen(piece.side, target)) continue;
          if (isWater(target)) continue;
          const jumpResult = jumpPath(board, source, target);
          if (!jumpResult) continue;
          if (occupant && !capturesAllowed(piece, source, target, occupant)) continue;
          moves.push({
            from: { ...source },
            to: { ...target },
            kind: 'jump',
            capturedId: occupant?.id,
            path: [source, ...jumpResult.path, target],
          });
        }
      }
    }
  }

  return moves.sort(compareMoves);
}

function compareMoves(a: Move, b: Move): number {
  if (a.from.y !== b.from.y) return a.from.y - b.from.y;
  if (a.from.x !== b.from.x) return a.from.x - b.from.x;
  if (a.to.y !== b.to.y) return a.to.y - b.to.y;
  if (a.to.x !== b.to.x) return a.to.x - b.to.x;
  if (a.kind !== b.kind) return a.kind === 'jump' ? -1 : 1;
  return (a.capturedId ?? '').localeCompare(b.capturedId ?? '');
}

export function cloneState(state: GameState): GameState {
  return structuredClone(state);
}

function findPiece(state: GameState, id: string): Piece | null {
  for (const cell of state.board) {
    if (cell.piece?.id === id) return cell.piece;
  }
  return null;
}

export function hashPosition(board: Cell[], turn: Side): string {
  let hash = turn === 'crimson' ? 'C' : 'T';
  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      const piece = board[cellIndex({ x, y })].piece;
      if (!piece) {
        hash += '.';
      } else {
        hash += `${piece.side === 'crimson' ? 'R' : 'B'}${RANK[piece.type]}`;
      }
    }
  }
  return hash;
}

export function notationForMove(move: Move, mover: Piece, captured?: Piece): string {
  const side = SIDE_SHORT[mover.side];
  const from = `${move.from.x},${move.from.y}行`;
  const to = `${move.to.x},${move.to.y}`;
  const beast = BEAST_NAMES[mover.type];
  const capturedText = captured ? ` × ${SIDE_SHORT[captured.side]}·${BEAST_NAMES[captured.type]}` : '';
  const suffix = move.kind === 'jump' ? ' 跃' : '';
  return `${side}·${beast} ${from}${to}${suffix}${capturedText}`;
}

export function applyMove(
  state: GameState,
  requestedMove: Move,
): { state: GameState; event: MoveEvent } {
  if (state.result) {
    throw new Error('对局已经结束');
  }
  const legal = getLegalMoves(state, requestedMove.from);
  const match = legal.find((move) => samePos(move.from, requestedMove.from) && samePos(move.to, requestedMove.to));
  if (!match) {
    throw new Error('非法着法');
  }

  const mover = pieceAt(state.board, match.from);
  if (!mover || mover.side !== state.turn) {
    throw new Error('不能操作对方棋子');
  }
  const captured = match.capturedId ? findPiece(state, match.capturedId) ?? null : null;
  const next = cloneState(state);
  next.board[cellIndex(match.from)].piece = null;
  next.board[cellIndex(match.to)].piece = mover;

  const trapApplied = isEnemyTrap(mover.side, match.to);

  if (captured) {
    next.noCapturePlies = 0;
  } else {
    next.noCapturePlies = state.noCapturePlies + 1;
  }

  next.ply = state.ply + 1;
  next.turn = otherSide(state.turn);

  let result: GameResult | null = null;
  if (isEnemyDen(mover.side, match.to)) {
    result = { status: 'win', winner: mover.side, reason: 'den' };
  }

  const positionHash = hashPosition(next.board, next.turn);
  next.positionCounts = { ...state.positionCounts };
  next.positionCounts[positionHash] = (next.positionCounts[positionHash] ?? 0) + 1;

  if (!result && next.positionCounts[positionHash] >= 3) {
    result = { status: 'draw', reason: 'repetition' };
  }
  if (!result && next.noCapturePlies >= 100) {
    result = { status: 'draw', reason: 'no-capture' };
  }

  if (!result) {
    const opponentMoves = getLegalMoves({ ...next, result: null });
    if (opponentMoves.length === 0) {
      result = { status: 'win', winner: mover.side, reason: 'no-moves' };
    }
  }

  next.result = result;
  const notation = notationForMove(match, mover, captured ?? undefined);
  const entry: HistoryEntry = {
    ply: next.ply,
    side: mover.side,
    move: match,
    notation,
    positionHash,
    captured: captured?.type,
  };
  next.history = [...state.history, entry];

  const event: MoveEvent = {
    move: match,
    side: mover.side,
    beast: mover.type,
    captured: captured
      ? { id: captured.id, side: captured.side, beast: captured.type }
      : undefined,
    trapApplied,
    result,
  };

  return { state: next, event };
}

export function undo(state: GameState, plies = 1): GameState {
  if (plies <= 0) return cloneState(state);
  const targetPly = Math.max(0, state.ply - plies);
  let current = cloneState(state);
  while (current.ply > targetPly && current.history.length > 0) {
    const last = current.history[current.history.length - 1];
    const next = cloneState(current);
    next.board[cellIndex(last.move.from)].piece = {
      id: `${last.side}-${beastTypeFromNotation(last.notation)}`,
      type: beastTypeFromNotation(last.notation),
      side: last.side,
    };
    next.board[cellIndex(last.move.to)].piece = null;
    if (last.captured) {
      const capturedSide = last.side === 'crimson' ? 'teal' : 'crimson';
      next.board[cellIndex(last.move.to)].piece = {
        id: `${capturedSide}-${last.captured}`,
        type: last.captured,
        side: capturedSide,
      };
    }
    next.ply = current.ply - 1;
    next.turn = otherSide(current.turn);
    next.history = current.history.slice(0, -1);
    next.noCapturePlies = recomputeNoCapture(next);
    next.positionCounts = recomputePositionCounts(next);
    next.result = null;
    current = next;
  }
  return current;
}

function beastTypeFromNotation(notation: string): BeastType {
  const match = notation.match(/·([^ ]+)/);
  if (!match) return 'rat';
  const name = match[1];
  const found = BEAST_TYPES.find((type) => BEAST_NAMES[type] === name);
  return found ?? 'rat';
}

function recomputeNoCapture(state: GameState): number {
  let count = 0;
  for (let index = state.history.length - 1; index >= 0; index -= 1) {
    if (state.history[index].captured) break;
    count += 1;
  }
  return count;
}

function recomputePositionCounts(state: GameState): Record<string, number> {
  const counts: Record<string, number> = {};
  let board = createInitialBoard();
  let turn: Side = 'crimson';
  const hash = hashPosition(board, turn);
  counts[hash] = 1;
  for (const entry of state.history) {
    const mover = pieceAt(board, entry.move.from);
    if (!mover) continue;
    board = board.map((cell) => ({ ...cell }));
    board[cellIndex(entry.move.from)].piece = null;
    board[cellIndex(entry.move.to)].piece = mover;
    turn = otherSide(turn);
    const nextHash = hashPosition(board, turn);
    counts[nextHash] = (counts[nextHash] ?? 0) + 1;
  }
  return counts;
}

export function moveEquals(a: Move, b: Move): boolean {
  return samePos(a.from, b.from) && samePos(a.to, b.to);
}

export function describeResult(result: GameResult | null): string {
  if (!result) return '对局进行中';
  if (result.status === 'draw') {
    if (result.reason === 'repetition') return '三次重复，和棋';
    if (result.reason === 'no-capture') return '百手无吃，和棋';
    return '和棋';
  }
  const winner = SIDE_NAMES[result.winner ?? 'crimson'];
  if (result.reason === 'den') return `${winner}入穴获胜`;
  if (result.reason === 'no-moves') return `${winner}对方无着，获胜`;
  return `${winner}获胜`;
}

export function pieceCount(state: GameState): Record<Side, number> {
  const count: Record<Side, number> = { crimson: 0, teal: 0 };
  for (const cell of state.board) {
    if (cell.piece) count[cell.piece.side] += 1;
  }
  return count;
}

export function capturedPieces(state: GameState): Record<Side, BeastType[]> {
  const captured: Record<Side, BeastType[]> = { crimson: [], teal: [] };
  const initial = createInitialBoard();
  const alive = new Set(state.board.map((cell) => cell.piece?.id).filter(Boolean));
  for (const cell of initial) {
    if (cell.piece && !alive.has(cell.piece.id)) {
      captured[cell.piece.side].push(cell.piece.type);
    }
  }
  return captured;
}
