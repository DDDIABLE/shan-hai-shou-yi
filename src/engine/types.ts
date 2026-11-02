export type Pos = { x: number; y: number };
export type Side = 'crimson' | 'teal';
export type GameMode = 'watch' | 'human-vs-ai' | 'local-pvp';
export type AiDifficulty = 'easy' | 'normal' | 'hard';

export type BeastType =
  | 'rat'
  | 'cat'
  | 'dog'
  | 'wolf'
  | 'leopard'
  | 'tiger'
  | 'lion'
  | 'elephant';

export type GameResult = {
  status: 'win' | 'draw';
  winner?: Side;
  reason: 'den' | 'no-moves' | 'repetition' | 'no-capture';
};

export type Move = {
  from: Pos;
  to: Pos;
  kind: 'step' | 'water-step' | 'jump';
  capturedId?: string;
  path?: Pos[];
};

export type HistoryEntry = {
  ply: number;
  side: Side;
  move: Move;
  notation: string;
  positionHash: string;
  captured?: BeastType;
};

export type Piece = {
  id: string;
  type: BeastType;
  side: Side;
};

export type Cell = {
  piece: Piece | null;
};

export type GameState = {
  version: 1;
  board: Cell[];
  turn: Side;
  mode: GameMode;
  difficulty: AiDifficulty;
  humanSide?: Side;
  seed: number;
  ply: number;
  noCapturePlies: number;
  positionCounts: Record<string, number>;
  result: GameResult | null;
  history: HistoryEntry[];
};

export type MoveEvent = {
  move: Move;
  side: Side;
  beast: BeastType;
  captured?: {
    id: string;
    side: Side;
    beast: BeastType;
  };
  trapApplied: boolean;
  result: GameResult | null;
};

export type AiRequest = {
  id: number;
  state: GameState;
  difficulty: AiDifficulty;
  seed: number;
};

export type AiResponse = {
  id: number;
  move: Move | null;
  error?: string;
};
