import { useEffect, useState } from "react";
import { File, Folder, Loader2 } from "lucide-react";
import { FileEntry } from "../types";
import { api, errorMessage } from "../lib/api";
import { formatSize, parentPath } from "../lib/format";
import EntryActions from "./EntryActions";

interface AnalysisListProps {
  kind: "largest" | "mostFiles";
  path: string;
  dataVersion: number;
  onNavigate: (path: string) => void;
  onDelete: (entry: FileEntry) => void;
  onOpenInExplorer: (path: string) => void;
}

export default function AnalysisList({
  kind,
  path,
  dataVersion,
  onNavigate,
  onDelete,
  onOpenInExplorer,
}: AnalysisListProps) {
  const [items, setItems] = useState<FileEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stale = false;
    setError(null);
    const request = kind === "largest" ? api.largestFiles(path) : api.foldersWithMostFiles(path);
    request
      .then((result) => !stale && setItems(result))
      .catch((e) => !stale && setError(errorMessage(e)));
    return () => {
      stale = true;
    };
  }, [kind, path, dataVersion]);

  const title = kind === "largest" ? "Top 100 Largest Files" : "Folders with Most Files";

  return (
    <div className="flex-1 overflow-auto p-4">
      <h3 className="text-lg font-semibold text-fg">{title}</h3>
      <p className="text-sm text-muted mb-4">
        {kind === "largest"
          ? "Every file in this folder and all its subfolders, largest first."
          : "Ranked by files directly inside each folder. These are often logs, caches, or temp files that can be cleaned up."}
      </p>

      {error && <div className="text-sm text-red-500">{error}</div>}
      {!items && !error && (
        <div className="flex items-center gap-2 text-sm text-subtle">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      )}
      {items && items.length === 0 && <div className="text-sm text-subtle">Nothing to show.</div>}

      <div className="space-y-0.5">
        {items?.map((item, index) => (
          <div
            key={item.path}
            className="flex items-center gap-3 px-2 py-1.5 rounded group hover:bg-raised/60"
            onDoubleClick={() => onNavigate(item.is_dir ? item.path : parentPath(item.path) ?? item.path)}
            title={item.is_dir ? "Double-click to open" : "Double-click to open containing folder"}
          >
            <span className="w-8 text-right text-sm text-subtle tabular-nums">#{index + 1}</span>
            {item.is_dir ? (
              <Folder className="w-4 h-4 text-yellow-500 flex-shrink-0" />
            ) : (
              <File className="w-4 h-4 text-subtle flex-shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <div className="text-sm text-fg truncate">{item.name}</div>
              <div className="text-xs text-subtle truncate">
                {item.is_dir ? item.path : parentPath(item.path)}
              </div>
            </div>
            <EntryActions entry={item} onOpenInExplorer={onOpenInExplorer} onDelete={onDelete} />
            {kind === "mostFiles" && (
              <span className="text-sm text-muted w-28 text-right tabular-nums">
                {(item.direct_file_count ?? 0).toLocaleString()} files
              </span>
            )}
            <span className="text-sm font-medium text-fg w-24 text-right tabular-nums">
              {formatSize(item.size)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
