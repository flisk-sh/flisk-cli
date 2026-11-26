/**
 * The Zachman board behind `flisk distribute board`: six perspectives by six questions, every
 * cell read from service.json or distribution.json; a cell with no data says what to add.
 */
import type { DiscoveredResource } from "../../types/index.js";
import { type DistributionFile } from "./channels.js";
/** Zachman's six perspectives, top to bottom, each with the lifecycle stage it answers for. */
export declare const BOARD_ROWS: readonly [{
    readonly perspective: "Planner";
    readonly view: "Scope";
    readonly stage: "Idea";
}, {
    readonly perspective: "Owner";
    readonly view: "Business";
    readonly stage: "Promise";
}, {
    readonly perspective: "Designer";
    readonly view: "System";
    readonly stage: "Shape";
}, {
    readonly perspective: "Builder";
    readonly view: "Technology";
    readonly stage: "Ship";
}, {
    readonly perspective: "Subcontractor";
    readonly view: "Component";
    readonly stage: "Listed";
}, {
    readonly perspective: "User";
    readonly view: "Operations";
    readonly stage: "Proof";
}];
export declare const BOARD_COLUMNS: readonly ["What", "How", "Where", "Who", "When", "Why"];
export type BoardPerspective = (typeof BOARD_ROWS)[number]["perspective"];
export type BoardColumn = (typeof BOARD_COLUMNS)[number];
export interface BoardCell {
    text: string;
    isMissing: boolean;
}
export interface BoardRow {
    perspective: BoardPerspective;
    view: string;
    stage: string;
    cells: Record<BoardColumn, BoardCell>;
}
export interface Board {
    rows: BoardRow[];
}
/**
 * The Zachman board. Rows are the six perspectives, columns the six questions. Every cell is read
 * from service.json or distribution.json; a cell with no data says what to add.
 */
export declare function buildBoard(resources: DiscoveredResource[], dist: DistributionFile | null): Board;
export declare function formatBoard(board: Board): string;
