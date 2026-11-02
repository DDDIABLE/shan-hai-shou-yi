import { useEffect, useRef } from 'react';
import { BEAST_NAMES, COLS, ROWS, SIDE_NAMES, isEnemyTrap, isWater, pieceAt } from '../engine/board';
import type { GameState, Pos } from '../engine/types';

type Props = {
  state: GameState;
  selected: Pos | null;
  legalTargets: Pos[];
  onSelect: (pos: Pos) => void;
};

export function KeyboardBoard({ state, selected, legalTargets, onSelect }: Props) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!selected) return;
    const index = selected.y * COLS + selected.x;
    const cell = gridRef.current?.querySelector<HTMLElement>(`[data-cell-index="${index}"]`);
    cell?.focus();
  }, [selected]);

  return (
    <div
      ref={gridRef}
      className="keyboard-board"
      role="grid"
      aria-label="七列九行棋盘"
    >
      {Array.from({ length: ROWS }, (_, y) => (
        <div className="keyboard-row" role="row" key={y}>
          {Array.from({ length: COLS }, (_, x) => {
            const pos = { x, y };
            const piece = pieceAt(state.board, pos);
            const isSelected = selected?.x === x && selected?.y === y;
            const isLegal = legalTargets.some((target) => target.x === x && target.y === y);
            const trapped = piece ? isEnemyTrap(piece.side, pos) : false;
            const label = piece
              ? `${SIDE_NAMES[piece.side]}${BEAST_NAMES[piece.type]}${isWater(pos) ? '在水中' : ''}${trapped ? '被困' : ''}`
              : `${x + 1}列${y + 1}行${isWater(pos) ? '水域' : ''}`;
            return (
              <button
                key={x}
                type="button"
                role="gridcell"
                data-cell-index={y * COLS + x}
                className={[
                  'keyboard-cell',
                  isSelected ? 'is-selected' : '',
                  isLegal ? 'is-legal' : '',
                  piece ? `side-${piece.side}` : '',
                  isWater(pos) ? 'is-water' : '',
                ].filter(Boolean).join(' ')}
                aria-label={label}
                aria-selected={isSelected}
                onClick={() => onSelect(pos)}
              >
                <span className="cell-coordinate">{x + 1},{y + 1}</span>
                {piece ? (
                  <span className="cell-piece">
                    {BEAST_NAMES[piece.type]}
                    <span className="cell-rank">等级 {piece.type === 'rat' ? 1 : piece.type === 'cat' ? 2 : piece.type === 'dog' ? 3 : piece.type === 'wolf' ? 4 : piece.type === 'leopard' ? 5 : piece.type === 'tiger' ? 6 : piece.type === 'lion' ? 7 : 8}{trapped ? '·困0' : ''}</span>
                  </span>
                ) : null}
                {isLegal ? <span className="legal-dot" aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
