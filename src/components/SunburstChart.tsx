import { useState, useMemo } from "react";
import { FileEntry } from "../types";
import { formatPercent, formatSize } from "../lib/format";

interface SunburstChartProps {
  data: FileEntry;
  onNavigate: (path: string) => void;
  onUp: (() => void) | null;
}

interface ArcData {
  entry: FileEntry;
  parentSize: number;
  startAngle: number;
  endAngle: number;
  innerRadius: number;
  outerRadius: number;
  color: string;
  depth: number;
}

const COLORS = [
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#06b6d4",
  "#6366f1",
];

const CENTER_X = 400;
const CENTER_Y = 350;
const INNER_RADIUS = 60;
const RADIUS_STEP = 70;
const MAX_DEPTH = 4;

function polarToCartesian(
  centerX: number,
  centerY: number,
  radius: number,
  angleInRadians: number
) {
  return {
    x: centerX + radius * Math.cos(angleInRadians),
    y: centerY + radius * Math.sin(angleInRadians),
  };
}

function describeArc(
  x: number,
  y: number,
  innerRadius: number,
  outerRadius: number,
  startAngle: number,
  endAngle: number
): string {
  // A full circle can't be drawn as a single arc; stop just short of it.
  const end = Math.min(endAngle, startAngle + 2 * Math.PI - 0.0001);
  const start1 = polarToCartesian(x, y, outerRadius, end);
  const end1 = polarToCartesian(x, y, outerRadius, startAngle);
  const start2 = polarToCartesian(x, y, innerRadius, startAngle);
  const end2 = polarToCartesian(x, y, innerRadius, end);

  const largeArcFlag = end - startAngle <= Math.PI ? "0" : "1";

  return [
    "M", start1.x, start1.y,
    "A", outerRadius, outerRadius, 0, largeArcFlag, 0, end1.x, end1.y,
    "L", start2.x, start2.y,
    "A", innerRadius, innerRadius, 0, largeArcFlag, 1, end2.x, end2.y,
    "Z",
  ].join(" ");
}

function buildArcs(
  entry: FileEntry,
  startAngle: number,
  endAngle: number,
  depth: number,
  innerRadius: number,
  color: string | null
): ArcData[] {
  if (depth > MAX_DEPTH || !entry.children || entry.children.length === 0 || entry.size === 0) {
    return [];
  }

  const arcs: ArcData[] = [];
  let currentAngle = startAngle;

  entry.children.forEach((child, index) => {
    if (child.size === 0) return;

    const childAngle = (child.size / entry.size) * (endAngle - startAngle);
    const childEndAngle = currentAngle + childAngle;
    // Descendants keep the colour of their top-level folder.
    const childColor = color ?? COLORS[index % COLORS.length];

    // Skip slivers under about half a degree.
    if (childAngle > 0.01) {
      arcs.push({
        entry: child,
        parentSize: entry.size,
        startAngle: currentAngle,
        endAngle: childEndAngle,
        innerRadius,
        outerRadius: innerRadius + RADIUS_STEP,
        color: childColor,
        depth,
      });

      if (child.is_dir && child.children) {
        arcs.push(
          ...buildArcs(child, currentAngle, childEndAngle, depth + 1, innerRadius + RADIUS_STEP, childColor)
        );
      }
    }

    currentAngle = childEndAngle;
  });

  return arcs;
}

export default function SunburstChart({ data, onNavigate, onUp }: SunburstChartProps) {
  const [hoveredArc, setHoveredArc] = useState<ArcData | null>(null);

  const arcs = useMemo(
    () => buildArcs(data, -Math.PI / 2, (3 * Math.PI) / 2, 1, INNER_RADIUS, null),
    [data]
  );

  return (
    <div className="relative flex-1 overflow-hidden p-4 flex items-center justify-center">
      {arcs.length === 0 && <div className="absolute text-subtle text-sm mt-48">This folder is empty</div>}
      <svg className="w-full h-full" viewBox="0 0 800 700" preserveAspectRatio="xMidYMid meet">
        <g
          className={onUp ? "cursor-pointer" : undefined}
          onClick={() => onUp?.()}
        >
          <title>{onUp ? "Up one level" : data.path}</title>
          <circle cx={CENTER_X} cy={CENTER_Y} r={INNER_RADIUS} fill="rgb(var(--c-raised))" />
          <text
            x={CENTER_X}
            y={CENTER_Y - 6}
            textAnchor="middle"
            fill="rgb(var(--c-fg))"
            fontSize="12"
            fontWeight="500"
          >
            {data.name.length > 14 ? data.name.slice(0, 13) + "…" : data.name}
          </text>
          <text x={CENTER_X} y={CENTER_Y + 12} textAnchor="middle" fill="rgb(var(--c-muted))" fontSize="11">
            {formatSize(data.size)}
          </text>
          {onUp && (
            <text x={CENTER_X} y={CENTER_Y + 28} textAnchor="middle" fill="rgb(var(--c-subtle))" fontSize="9">
              ↑ up
            </text>
          )}
        </g>

        {arcs.map((arc) => (
          <path
            key={arc.entry.path}
            d={describeArc(CENTER_X, CENTER_Y, arc.innerRadius, arc.outerRadius, arc.startAngle, arc.endAngle)}
            fill={arc.color}
            opacity={hoveredArc?.entry.path === arc.entry.path ? 1 : 0.9 - arc.depth * 0.12}
            stroke="rgb(var(--c-app))"
            strokeWidth="1"
            className={`${arc.entry.is_dir ? "cursor-pointer" : "cursor-default"} transition-opacity`}
            onMouseEnter={() => setHoveredArc(arc)}
            onMouseLeave={() => setHoveredArc(null)}
            onClick={() => arc.entry.is_dir && onNavigate(arc.entry.path)}
          />
        ))}
      </svg>

      {hoveredArc && (
        <div className="absolute top-4 right-4 bg-panel border border-line rounded-lg p-4 shadow-xl w-64">
          <div className="font-medium text-fg mb-2 truncate">{hoveredArc.entry.name}</div>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted">Size:</span>
              <span className="text-fg">{formatSize(hoveredArc.entry.size)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Type:</span>
              <span className="text-fg">{hoveredArc.entry.is_dir ? "Folder" : "File"}</span>
            </div>
            {hoveredArc.entry.file_count !== undefined && (
              <div className="flex justify-between">
                <span className="text-muted">Files:</span>
                <span className="text-fg">{hoveredArc.entry.file_count.toLocaleString()}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted">% of parent:</span>
              <span className="text-fg">{formatPercent(hoveredArc.entry.size, hoveredArc.parentSize)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">% of this view:</span>
              <span className="text-fg">{formatPercent(hoveredArc.entry.size, data.size)}</span>
            </div>
          </div>
          {hoveredArc.entry.is_dir && <div className="text-xs text-blue-500 mt-2">Click to open</div>}
        </div>
      )}

      <div className="absolute bottom-4 left-4 bg-panel/80 border border-line rounded-lg p-3">
        <div className="text-xs text-muted mb-1">Showing {MAX_DEPTH} levels</div>
        <div className="text-xs text-subtle">Inner → outer = parent → children</div>
        <div className="text-xs text-subtle">Tiny items are hidden</div>
      </div>
    </div>
  );
}
