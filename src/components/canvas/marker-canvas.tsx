"use client";
/**
 * One canvas, three modes (SPEC §6.3). An SVG overlay in image-pixel space stacked over
 * the <img>; the browser scales both together, so a marker drawn at (x·W, y·H) sits on
 * the same pixel the scorer tests. Controlled: the parent owns marker state and receives
 * one callback per completed gesture (pointer-up), never per pointer-move.
 */
import { useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import type { GameImage, Normalized, NormalizedPoint } from "@/lib/types";
import { clamp01, nudge, radiusFromHandle, radiusPx, toNormalized, toPixel, type Rect } from "./geometry";
import { useCoarsePointer } from "./use-coarse-pointer";

type CanvasMode = "play" | "author" | "reveal";

export type CanvasMarker = {
  readonly id: string;
  readonly x: Normalized;
  readonly y: Normalized;
  /** Present in author/reveal (an object's hit circle); absent in play (an unlabelled guess). */
  readonly radius?: Normalized;
  readonly label?: string;
  readonly confirmed?: boolean;
};

type MarkerCanvasProps = {
  readonly image: GameImage;
  readonly mode: CanvasMode;
  readonly markers: readonly CanvasMarker[];
  readonly selectedId?: string | null;
  /** play: fewer than N markers placed; author: an unplaced object is selected. */
  readonly canAdd?: boolean;
  readonly onAdd?: (point: NormalizedPoint) => void;
  readonly onMove?: (id: string, point: NormalizedPoint) => void;
  readonly onResize?: (id: string, radius: Normalized) => void;
  readonly onRemove?: (id: string) => void;
  readonly onSelect?: (id: string) => void;
  /** play: releasing a marker over this element removes it. */
  readonly trashRef?: RefObject<HTMLElement | null>;
};

type Drag = {
  readonly id: string;
  readonly kind: "center" | "handle";
  readonly point: NormalizedPoint;
  /** Whether a pointermove has fired since pointerdown; a click with no movement commits nothing. */
  readonly moved: boolean;
  /** Normalized offset (handle centre − pointerdown), added back on every move so a handle
   *  grabbed off-centre doesn't snap the circle to the raw pointer position. Zero for "center" drags. */
  readonly offset: { readonly dx: number; readonly dy: number };
};

/** A gesture's accumulated-but-uncommitted keyboard nudge (author mode only, one write per gesture). */
type Nudging = { readonly id: string; readonly point: NormalizedPoint };

const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as const;
const NO_RECT: Rect = { left: 0, top: 0, width: 0, height: 0 };

function over(el: HTMLElement | null | undefined, clientX: number, clientY: number): boolean {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
}

export function MarkerCanvas(props: MarkerCanvasProps) {
  const { image, mode, markers, selectedId = null, canAdd = false, trashRef } = props;
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [overTrash, setOverTrash] = useState(false);
  const [nudging, setNudging] = useState<Nudging | null>(null);
  const coarse = useCoarsePointer();
  const hit = coarse ? 2.4 : 1;
  const readOnly = mode === "reveal";
  const dotR = image.width * 0.015;
  const stroke = Math.max(2, image.width * 0.003);
  const rect = (): Rect => svgRef.current?.getBoundingClientRect() ?? NO_RECT;
  const find = (id: string) => markers.find((m) => m.id === id);

  function onBackgroundPointerDown(e: PointerEvent<SVGSVGElement>) {
    if (readOnly || !canAdd || e.target !== e.currentTarget) return;
    const p = toNormalized(e.clientX, e.clientY, rect(), { clamp: false });
    if (p) props.onAdd?.(p);
  }

  function startDrag(e: PointerEvent<SVGElement>, id: string, kind: Drag["kind"]) {
    if (readOnly) return;
    e.stopPropagation();
    const m = find(id);
    if (!m) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    props.onSelect?.(id);
    const pointerDown = toNormalized(e.clientX, e.clientY, rect(), { clamp: true }) ?? { x: m.x, y: m.y };
    if (kind === "handle" && m.radius !== undefined) {
      // Handle centre per the SVG render: { x: m.x + radiusPx(m.radius, image) / image.width, y: m.y } = { x: m.x + m.radius, y: m.y }.
      const handleCentre: NormalizedPoint = { x: clamp01(m.x + m.radius), y: m.y };
      const offset = { dx: handleCentre.x - pointerDown.x, dy: handleCentre.y - pointerDown.y };
      setDrag({ id, kind, point: pointerDown, moved: false, offset });
      return;
    }
    setDrag({ id, kind: "center", point: { x: m.x, y: m.y }, moved: false, offset: { dx: 0, dy: 0 } });
  }

  function onPointerMove(e: PointerEvent<SVGElement>) {
    if (!drag) return;
    const p = toNormalized(e.clientX, e.clientY, rect(), { clamp: true });
    if (!p) return;
    const point = drag.kind === "handle" ? { x: clamp01(p.x + drag.offset.dx), y: clamp01(p.y + drag.offset.dy) } : p;
    setDrag({ ...drag, point, moved: true });
    if (mode === "play") setOverTrash(over(trashRef?.current, e.clientX, e.clientY));
  }

  function endDrag(e: PointerEvent<SVGElement>) {
    if (!drag) return;
    // A click with no movement in between is not a gesture: nothing to commit, no callbacks.
    if (!drag.moved) {
      setDrag(null);
      setOverTrash(false);
      return;
    }
    const m = find(drag.id);
    if (m) {
      if (drag.kind === "handle") {
        const radius = radiusFromHandle({ x: m.x, y: m.y }, drag.point, image);
        if (radius !== m.radius) props.onResize?.(m.id, radius);
      } else if (mode === "play" && over(trashRef?.current, e.clientX, e.clientY)) {
        props.onRemove?.(m.id);
      } else if (drag.point.x !== m.x || drag.point.y !== m.y) {
        props.onMove?.(m.id, drag.point);
      }
    }
    setDrag(null);
    setOverTrash(false);
  }

  /** A cancelled pointer (touch interrupted, capture lost) discards the gesture; nothing is committed. */
  function cancelDrag() {
    setDrag(null);
    setOverTrash(false);
  }

  function onKeyDown(e: KeyboardEvent<SVGGElement>, m: CanvasMarker) {
    if (readOnly) return;
    const d = ARROWS[e.key as keyof typeof ARROWS];
    if (d) {
      e.preventDefault();
      if (mode === "author") {
        // Accumulate locally across the held-key gesture; committed once on keyup/blur.
        const base = nudging && nudging.id === m.id ? nudging.point : { x: m.x, y: m.y };
        setNudging({ id: m.id, point: nudge(base, d[0], d[1]) });
      } else {
        props.onMove?.(m.id, nudge({ x: m.x, y: m.y }, d[0], d[1]));
      }
      return;
    }
    if (mode === "play" && (e.key === "Delete" || e.key === "Backspace")) {
      e.preventDefault();
      props.onRemove?.(m.id);
    }
  }

  /** Commit an accumulated author-mode nudge once, on release of the key (or loss of focus). */
  function commitNudge(m: CanvasMarker) {
    if (mode !== "author" || !nudging || nudging.id !== m.id) return;
    props.onMove?.(m.id, nudging.point);
    setNudging(null);
  }

  function onKeyUp(e: KeyboardEvent<SVGGElement>, m: CanvasMarker) {
    if (mode !== "author" || !(e.key in ARROWS)) return;
    commitNudge(m);
  }

  return (
    <div className="relative w-full select-none" data-testid="marker-canvas" data-mode={mode}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={image.url} width={image.width} height={image.height} alt="" draggable={false} className="block h-auto w-full" />
      <svg
        ref={svgRef}
        viewBox={`0 0 ${image.width} ${image.height}`}
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full touch-none"
        role="application"
        aria-label={mode === "play" ? "Place your markers" : "Object positions"}
        onPointerDown={onBackgroundPointerDown}
      >
        {markers.map((m) => {
          const dragging = drag?.id === m.id ? drag : null;
          const nudgingThis = mode === "author" && nudging?.id === m.id ? nudging : null;
          const center = dragging?.kind === "center" ? dragging.point : nudgingThis ? nudgingThis.point : { x: m.x, y: m.y };
          const radius = m.radius === undefined ? null : dragging?.kind === "handle" ? radiusFromHandle(center, dragging.point, image) : m.radius;
          const c = toPixel(center, image);
          const rPx = radius === null ? 0 : radiusPx(radius, image);
          const selected = selectedId === m.id;
          const unconfirmed = m.confirmed === false;
          return (
            <g
              key={m.id}
              data-testid="marker"
              data-marker-id={m.id}
              data-selected={selected || undefined}
              data-over-trash={(dragging !== null && overTrash) || undefined}
              tabIndex={readOnly ? -1 : 0}
              className="outline-none focus-visible:[&>circle:last-of-type]:stroke-yellow-400"
              style={{ cursor: readOnly ? "default" : dragging ? "grabbing" : "grab" }}
              onKeyDown={(e) => onKeyDown(e, m)}
              onKeyUp={(e) => onKeyUp(e, m)}
              onBlur={() => commitNudge(m)}
              onPointerDown={(e) => startDrag(e, m.id, "center")}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={cancelDrag}
            >
              {radius !== null && (
                <circle
                  cx={c.x}
                  cy={c.y}
                  r={rPx}
                  fill={selected ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.001)"}
                  stroke={unconfirmed ? "#f59e0b" : "#22c55e"}
                  strokeWidth={stroke}
                  strokeDasharray={unconfirmed ? `${stroke * 3} ${stroke * 2}` : undefined}
                />
              )}
              <circle cx={c.x} cy={c.y} r={dotR * hit} fill="transparent" />
              {m.label && (
                <text
                  x={c.x}
                  y={c.y - (radius === null ? dotR : rPx) - stroke * 2}
                  textAnchor="middle"
                  fontSize={image.width * 0.022}
                  fill="#fff"
                  stroke="#000"
                  strokeWidth={stroke / 2}
                  paintOrder="stroke"
                >
                  {m.label}
                </text>
              )}
              <circle cx={c.x} cy={c.y} r={dotR} fill={mode === "play" ? "rgba(239,68,68,0.9)" : "rgba(255,255,255,0.95)"} stroke="#111" strokeWidth={stroke} />
              {mode === "author" && radius !== null && (
                <circle cx={c.x + rPx} cy={c.y} r={dotR * 0.8 * hit} fill="transparent" style={{ cursor: "ew-resize" }} onPointerDown={(e) => startDrag(e, m.id, "handle")} />
              )}
              {mode === "author" && radius !== null && (
                <circle
                  data-testid="radius-handle"
                  cx={c.x + rPx}
                  cy={c.y}
                  r={dotR * 0.8}
                  fill="#fff"
                  stroke="#111"
                  strokeWidth={stroke}
                  style={{ cursor: "ew-resize" }}
                  onPointerDown={(e) => startDrag(e, m.id, "handle")}
                />
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
