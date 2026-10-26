import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, File, Folder, Loader2 } from "lucide-react";
import { FileEntry, SortBy } from "../types";
import { api } from "../lib/api";
import { getEntryColor } from "../lib/colors";
import { formatPercent, formatSize, sortEntries } from "../lib/format";
import EntryActions from "./EntryActions";

const ROW_HEIGHT = 30;
const OVERSCAN = 10;

interface TreeViewProps {
  root: FileEntry;
  sortBy: SortBy;
  filter: string;
  /** Changes whenever the scan data changes, so cached folders get refetched. */
  dataVersion: number;
  onNavigate: (path: string) => void;
  onDelete: (entry: FileEntry) => void;
  onOpenInExplorer: (path: string) => void;
}

type Row =
  | { kind: "entry"; entry: FileEntry; depth: number }
  | { kind: "loading"; key: string; depth: number }
  | { kind: "omitted"; key: string; count: number; depth: number };

export default function TreeView({
  root,
  sortBy,
  filter,
  dataVersion,
  onNavigate,
  onDelete,
  onOpenInExplorer,
}: TreeViewProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [cache, setCache] = useState<Map<string, FileEntry>>(new Map());
  const loading = useRef<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);

  // A different folder starts collapsed; new data keeps expansion but refetches.
  useEffect(() => {
    setExpanded(new Set());
    scrollRef.current?.scrollTo({ top: 0 });
  }, [root.path]);

  useEffect(() => {
    setCache(new Map());
    loading.current.clear();
  }, [root.path, dataVersion]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setViewportHeight(el.clientHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Fetch children for expanded folders that aren't loaded yet.
  useEffect(() => {
    for (const path of expanded) {
      if (cache.has(path) || loading.current.has(path)) continue;
      loading.current.add(path);
      api
        .getNode(path, 1)
        .then((node) => setCache((prev) => new Map(prev).set(path, node)))
        .catch(() =>
          setExpanded((prev) => {
            const next = new Set(prev);
            next.delete(path);
            return next;
          })
        )
        .finally(() => loading.current.delete(path));
    }
  }, [expanded, cache]);

  const rows = useMemo(() => {
    const result: Row[] = [];
    const query = filter.trim().toLowerCase();

    const addChildren = (node: FileEntry, depth: number) => {
      let children = sortEntries(node.children ?? [], sortBy);
      if (depth === 0 && query) {
        children = children.filter((c) => c.name.toLowerCase().includes(query));
      }
      for (const child of children) {
        result.push({ kind: "entry", entry: child, depth });
        if (child.is_dir && expanded.has(child.path)) {
          const loaded = cache.get(child.path);
          if (loaded) addChildren(loaded, depth + 1);
          else result.push({ kind: "loading", key: `${child.path}::loading`, depth: depth + 1 });
        }
      }
      if (node.omitted_children && !(depth === 0 && query)) {
        result.push({
          kind: "omitted",
          key: `${node.path}::omitted`,
          count: node.omitted_children,
          depth,
        });
      }
    };

    addChildren(root, 0);
    return result;
  }, [root, cache, expanded, sortBy, filter]);

  const toggle = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN);

  return (
    <div
      ref={scrollRef}
      className="flex-1 overflow-auto"
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      {rows.length === 0 && (
        <div className="h-full flex items-center justify-center text-subtle text-sm">
          {filter ? "Nothing matches the filter" : "This folder is empty"}
        </div>
      )}
      <div className="relative p-2" style={{ height: rows.length * ROW_HEIGHT + 16 }}>
        {rows.slice(first, last).map((row, i) => {
          const top = (first + i) * ROW_HEIGHT + 8;
          const indent = row.depth * 16 + 8;

          if (row.kind !== "entry") {
            return (
              <div
                key={row.key}
                className="absolute left-2 right-2 flex items-center gap-2 text-xs text-subtle"
                style={{ top, height: ROW_HEIGHT, paddingLeft: indent + 24 }}
              >
                {row.kind === "loading" ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
                  </>
                ) : (
                  <>… {row.count.toLocaleString()} smaller items not shown</>
                )}
              </div>
            );
          }

          const { entry } = row;
          const isOpen = expanded.has(entry.path);
          const canExpand = entry.is_dir && entry.has_children;
          const share = root.size > 0 ? (entry.size / root.size) * 100 : 0;

          return (
            <div
              key={entry.path}
              className="absolute left-2 right-2 flex items-center gap-2 px-2 rounded cursor-default select-none group hover:bg-raised/60"
              style={{ top, height: ROW_HEIGHT, paddingLeft: indent }}
              onClick={() => canExpand && toggle(entry.path)}
              onDoubleClick={() => entry.is_dir && onNavigate(entry.path)}
              title={entry.is_dir ? "Click to expand, double-click to open" : entry.path}
            >
              <span className="w-4 h-4 flex items-center justify-center text-subtle flex-shrink-0">
                {canExpand &&
                  (isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />)}
              </span>

              {entry.is_dir ? (
                <Folder className="w-4 h-4 text-yellow-500 flex-shrink-0" />
              ) : (
                <File className="w-4 h-4 text-subtle flex-shrink-0" />
              )}

              <span className="flex-1 truncate text-sm text-fg">{entry.name}</span>

              <EntryActions entry={entry} onOpenInExplorer={onOpenInExplorer} onDelete={onDelete} />

              {entry.is_dir && (
                <span className="text-xs text-subtle w-24 text-right flex-shrink-0 hidden lg:inline">
                  {(entry.file_count ?? 0).toLocaleString()} files
                </span>
              )}
              {!entry.is_dir && <span className="w-24 flex-shrink-0 hidden lg:inline" />}

              <div className="w-24 h-2 bg-raised rounded-full overflow-hidden flex-shrink-0">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${Math.max(share, 1)}%`, backgroundColor: getEntryColor(entry) }}
                />
              </div>

              <span
                className="text-xs text-muted w-20 text-right flex-shrink-0 tabular-nums"
                title={`${entry.size.toLocaleString()} bytes on disk\n${entry.logical_size.toLocaleString()} bytes actual size`}
              >
                {formatSize(entry.size)}
              </span>

              <span className="text-xs text-subtle w-14 text-right flex-shrink-0 tabular-nums">
                {formatPercent(entry.size, root.size)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
