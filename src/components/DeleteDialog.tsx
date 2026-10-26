import { useEffect, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { FileEntry } from "../types";
import { formatSize } from "../lib/format";

interface DeleteDialogProps {
  entry: FileEntry;
  onConfirm: (permanent: boolean) => Promise<void>;
  onCancel: () => void;
}

export default function DeleteDialog({ entry, onConfirm, onCancel }: DeleteDialogProps) {
  const [permanent, setPermanent] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm(permanent);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={() => !busy && onCancel()}
    >
      <div
        className="bg-panel border border-line rounded-lg shadow-2xl w-full max-w-lg p-5"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <h2 className="text-lg font-semibold text-fg mb-1">
          Delete {entry.is_dir ? "folder" : "file"}?
        </h2>
        <div className="text-sm text-fg font-medium break-all">{entry.name}</div>
        <div className="text-xs text-subtle break-all mb-3">{entry.path}</div>
        <div className="text-sm text-muted mb-4">
          {formatSize(entry.size)}
          {entry.is_dir && ` · ${(entry.file_count ?? 0).toLocaleString()} files`}
        </div>

        <label className="flex items-start gap-2 text-sm text-muted mb-5 cursor-pointer">
          <input
            type="checkbox"
            className="mt-1"
            checked={permanent}
            onChange={(e) => setPermanent(e.target.checked)}
          />
          <span>
            Delete permanently (skip the Recycle Bin).{" "}
            {permanent && <span className="text-red-500 font-medium">This can't be undone.</span>}
          </span>
        </label>

        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="px-3 py-1.5 rounded text-sm bg-raised text-fg hover:bg-line disabled:opacity-50"
            autoFocus
          >
            Cancel
          </button>
          <button
            onClick={confirm}
            disabled={busy}
            className="flex items-center gap-2 px-3 py-1.5 rounded text-sm font-medium bg-red-600 hover:bg-red-500 text-white disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            {permanent ? "Delete permanently" : "Move to Recycle Bin"}
          </button>
        </div>
      </div>
    </div>
  );
}
