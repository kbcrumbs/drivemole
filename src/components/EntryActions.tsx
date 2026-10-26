import { ExternalLink, Trash2 } from "lucide-react";
import { FileEntry } from "../types";

interface EntryActionsProps {
  entry: FileEntry;
  onOpenInExplorer: (path: string) => void;
  onDelete: (entry: FileEntry) => void;
}

/** Open / delete buttons that appear when hovering a row (needs a `group` parent). */
export default function EntryActions({ entry, onOpenInExplorer, onDelete }: EntryActionsProps) {
  return (
    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
      <button
        onClick={(e) => {
          e.stopPropagation();
          onOpenInExplorer(entry.path);
        }}
        onDoubleClick={(e) => e.stopPropagation()}
        className="p-1 rounded text-muted hover:text-fg hover:bg-line"
        title="Show in Explorer"
      >
        <ExternalLink className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete(entry);
        }}
        onDoubleClick={(e) => e.stopPropagation()}
        className="p-1 rounded text-red-500 hover:text-white hover:bg-red-600"
        title="Delete"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
