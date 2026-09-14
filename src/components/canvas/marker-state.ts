/** Play-mode marker state. Pure so the component stays thin and this stays unit-testable. */
import type { Normalized, NormalizedPoint } from "@/lib/types";

type PlayMarker = { readonly id: string; readonly x: Normalized; readonly y: Normalized };

export type MarkerState = {
  readonly markers: readonly PlayMarker[];
  readonly selected: string | null;
};

export type MarkerAction =
  | { type: "add"; id: string; point: NormalizedPoint }
  | { type: "move"; id: string; point: NormalizedPoint }
  | { type: "remove"; id: string }
  | { type: "select"; id: string | null };

export const EMPTY_MARKERS: MarkerState = { markers: [], selected: null };

export function markerReducer(state: MarkerState, action: MarkerAction, max: number): MarkerState {
  switch (action.type) {
    case "add": {
      if (state.markers.length >= max) return state;
      return { markers: [...state.markers, { id: action.id, x: action.point.x, y: action.point.y }], selected: action.id };
    }
    case "move": {
      if (!state.markers.some((m) => m.id === action.id)) return state;
      return {
        ...state,
        markers: state.markers.map((m) => (m.id === action.id ? { ...m, x: action.point.x, y: action.point.y } : m)),
      };
    }
    case "remove":
      return {
        markers: state.markers.filter((m) => m.id !== action.id),
        selected: state.selected === action.id ? null : state.selected,
      };
    case "select":
      return { ...state, selected: action.id };
  }
}

/** SPEC §3.3.4: exactly N markers before submitting. */
export function canSubmit(state: MarkerState, required: number): boolean {
  return state.markers.length === required;
}
