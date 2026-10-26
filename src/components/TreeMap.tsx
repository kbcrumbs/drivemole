import { useEffect, useMemo, useRef, useState } from "react";
import { FileEntry } from "../types";
import { CATEGORIES, getCategory, getEntryColor } from "../lib/colors";
import { formatPercent, formatSize } from "../lib/format";

interface TreeMapProps {
  data: FileEntry;
  onNavigate: (path: string) => void;
}

/** Beyond this many rectangles the rest are grouped into one "smaller items" block. */
const MAX_ITEMS = 400;

interface Item {
  entry: FileEntry | null;
  label: string;
  size: number;
  color: string;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Worst aspect ratio of a row with total area `sum`, laid along a side of length `side`. */
function worstRatio(sum: number, min: number, max: number, side: number): number {
  const s2 = sum * sum;
  const side2 = side * side;
  return Math.max((side2 * max) / s2, s2 / (side2 * min));
}

/** Squarified treemap layout (Bruls et al.). Items must be sorted largest first. */
function squarify(sizes: number[], bounds: Rect): Rect[] {
  const total = sizes.reduce((a, b) => a + b, 0);
  if (total <= 0 || bounds.w <= 0 || bounds.h <= 0) return [];
  const scale = (bounds.w * bounds.h) / total;
  const areas = sizes.map((s) => s * scale);
  const rects: Rect[] = [];
  let { x, y, w, h } = bounds;

  let i = 0;
  while (i < areas.length) {
    const side = Math.min(w, h);
    let sum = areas[i];
    let min = sum;
    let max = sum;
    let worst = worstRatio(sum, min, max, side);
    let j = i + 1;
    while (j < areas.length) {
      const a = areas[j];
      const next = worstRatio(sum + a, Math.min(min, a), Math.max(max, a), side);
      if (next > worst) break;
      sum += a;
      min = Math.min(min, a);
      max = Math.max(max, a);
      worst = next;
      j++;
    }

    const thickness = sum / side;
    let offset = 0;
    for (let k = i; k < j; k++) {
      const length = areas[k] / thickness;
      if (w >= h) {
        rects.push({ x, y: y + offset, w: thickness, h: length });
      } else {
        rects.push({ x: x + offset, y, w: length, h: thickness });
      }
      offset += length;
    }
    if (w >= h) {
      x += thickness;
      w -= thickness;
    } else {
      y += thickness;
      h -= thickness;
    }
    i = j;
  }
  return rects;
}

export default function TreeMap({ data, onNavigate }: TreeMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [hovered, setHovered] = useState<number | null>(null);
  const [mouse, setMouse] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() =>
      setSize({ width: el.clientWidth, height: el.clientHeight })
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const items = useMemo<Item[]>(() => {
    const children = (data.children ?? []).filter((c) => c.size > 0);
    const shown: Item[] = children.slice(0, MAX_ITEMS).map((entry) => ({
      entry,
      label: entry.name,
      size: entry.size,
      color: getEntryColor(entry),
    }));
    const rest = children.slice(MAX_ITEMS);
    const restSize =
      rest.reduce((sum, c) => sum + c.size, 0) +
      Math.max(0, data.size - children.reduce((sum, c) => sum + c.size, 0));
    const restCount = rest.length + (data.omitted_children ?? 0);
    if (restCount > 0 && restSize > 0) {
      shown.push({
        entry: null,
        label: `${restCount.toLocaleString()} smaller items`,
        size: restSize,
        color: CATEGORIES.other.color,
      });
    }
    return shown.sort((a, b) => b.size - a.size);
  }, [data]);

  const rects = useMemo(
    () => squarify(items.map((i) => i.size), { x: 0, y: 0, w: size.width, h: size.height }),
    [items, size]
  );

  const categories = useMemo(
    () => [...new Set(items.filter((i) => i.entry).map((i) => getCategory(i.entry!)))],
    [items]
  );

  const hoveredItem = hovered !== null ? items[hovered] : null;

  return (
    <div className="flex-1 flex flex-col overflow-hidden p-3 gap-2">
      <div
        ref={containerRef}
        className="relative flex-1 overflow-hidden"
        onMouseMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          setMouse({ x: e.clientX - box.left, y: e.clientY - box.top });
        }}
        onMouseLeave={() => setHovered(null)}
      >
        {items.length === 0 && (
          <div className="h-full flex items-center justify-center text-subtle text-sm">
            This folder is empty
          </div>
        )}
        <svg width={size.width} height={size.height} className="block">
          {rects.map((r, index) => {
            const item = items[index];
            const isDir = item.entry?.is_dir ?? false;
            const showLabel = r.w > 60 && r.h > 34;
            return (
              <g key={item.entry?.path ?? "__rest"}>
                <rect
                  x={r.x + 1}
                  y={r.y + 1}
                  width={Math.max(0, r.w - 2)}
                  height={Math.max(0, r.h - 2)}
                  fill={item.color}
                  opacity={hovered === index ? 1 : 0.82}
                  rx={3}
                  className={`${isDir ? "cursor-pointer" : "cursor-default"} transition-opacity`}
                  onMouseEnter={() => setHovered(index)}
                  onClick={() => isDir && item.entry && onNavigate(item.entry.path)}
                />
                {showLabel && (
                  <>
                    <text
                      x={r.x + r.w / 2}
                      y={r.y + r.h / 2 - 5}
                      textAnchor="middle"
                      fill="white"
                      fontSize={Math.min(14, r.w / 10)}
                      fontWeight="500"
                      className="pointer-events-none select-none"
                    >
                      {item.label.length > 24 ? item.label.slice(0, 22) + "…" : item.label}
                    </text>
                    <text
                      x={r.x + r.w / 2}
                      y={r.y + r.h / 2 + 11}
                      textAnchor="middle"
                      fill="rgba(255,255,255,0.75)"
                      fontSize={Math.min(11, r.w / 12)}
                      className="pointer-events-none select-none"
                    >
                      {formatSize(item.size)}
                    </text>
                  </>
                )}
              </g>
            );
          })}
        </svg>

        {hoveredItem && (
          <div
            className="absolute bg-panel border border-line rounded-lg p-3 shadow-xl pointer-events-none z-10 w-60"
            style={{
              left: Math.max(0, Math.min(mouse.x + 16, size.width - 248)),
              top: Math.max(0, Math.min(mouse.y + 16, size.height - 120)),
            }}
          >
            <div className="font-medium text-fg mb-1 truncate">{hoveredItem.label}</div>
            <div className="text-sm text-muted">
              {formatSize(hoveredItem.size)} · {formatPercent(hoveredItem.size, data.size)} of this folder
            </div>
            <div className="text-sm text-muted">
              {!hoveredItem.entry
                ? "Grouped together"
                : hoveredItem.entry.is_dir
                  ? `Folder · ${(hoveredItem.entry.file_count ?? 0).toLocaleString()} files`
                  : CATEGORIES[getCategory(hoveredItem.entry)].label}
            </div>
            {hoveredItem.entry?.is_dir && <div className="text-xs text-blue-500 mt-1">Click to open</div>}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {categories.map((c) => (
          <span key={c} className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: CATEGORIES[c].color }} />
            {CATEGORIES[c].label}
          </span>
        ))}
      </div>
    </div>
  );
}
