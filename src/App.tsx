import { useState, useEffect, useCallback, useRef } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUp,
  ChevronRight,
  FileText,
  Files,
  Folder,
  FolderOpen,
  HardDrive,
  LayoutGrid,
  List,
  Moon,
  PieChart,
  RefreshCw,
  Search,
  Sun,
  X,
} from "lucide-react";
import {
  AnalysisTab,
  DriveInfo,
  FileEntry,
  ScanProgress,
  ScanSummary,
  SortBy,
  ViewMode,
} from "./types";
import { api, errorMessage, NOT_IN_SCAN } from "./lib/api";
import { formatSize, isWithin, parentPath, pathSegments } from "./lib/format";
import TreeView from "./components/TreeView";
import TreeMap from "./components/TreeMap";
import SunburstChart from "./components/SunburstChart";
import AnalysisList from "./components/AnalysisList";
import DeleteDialog from "./components/DeleteDialog";

type Theme = "dark" | "light";

function loadSetting<T extends string>(key: string, fallback: T): T {
  try {
    return (localStorage.getItem(key) as T | null) ?? fallback;
  } catch {
    return fallback;
  }
}

function saveSetting(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Settings are a convenience; ignore storage failures.
  }
}

function loadRecent(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem("drivemole.recent") ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((p) => typeof p === "string") : [];
  } catch {
    return [];
  }
}

const systemTheme = (): Theme =>
  window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";

function App() {
  const [drives, setDrives] = useState<DriveInfo[]>([]);
  const [rootPath, setRootPath] = useState<string | null>(null);
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [view, setView] = useState<FileEntry | null>(null);
  const [dataVersion, setDataVersion] = useState(0);
  const [backStack, setBackStack] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [lastScan, setLastScan] = useState<ScanSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<FileEntry | null>(null);
  const [sortBy, setSortBy] = useState<SortBy>("size");
  const [viewMode, setViewMode] = useState<ViewMode>(() => loadSetting("drivemole.view", "tree"));
  const [searchQuery, setSearchQuery] = useState("");
  const [recent, setRecent] = useState<string[]>(loadRecent);
  const [theme, setTheme] = useState<Theme>(() => loadSetting("drivemole.theme", systemTheme()));
  const [analysisTab, setAnalysisTab] = useState<AnalysisTab>("none");
  const scanningRef = useRef(false);

  useEffect(() => {
    document.documentElement.className = theme;
    saveSetting("drivemole.theme", theme);
  }, [theme]);

  useEffect(() => saveSetting("drivemole.view", viewMode), [viewMode]);

  useEffect(() => {
    api.getDrives().then(setDrives).catch((e) => setError(`Couldn't list drives: ${errorMessage(e)}`));

    const unlisten = listen<ScanProgress>("scan-progress", (event) => {
      if (scanningRef.current) setProgress(event.payload);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Load the current folder from the scan whenever it, the view, or the data changes.
  useEffect(() => {
    if (!currentPath || scanning) return;
    let stale = false;
    api
      .getNode(currentPath, viewMode === "sunburst" ? 4 : 1)
      .then((node) => !stale && setView(node))
      .catch((e) => {
        if (stale) return;
        // The folder was deleted or is gone from the scan: fall back to its parent.
        const parent = parentPath(currentPath);
        if (errorMessage(e) === NOT_IN_SCAN && parent && rootPath && isWithin(parent, rootPath)) {
          setCurrentPath(parent);
        } else {
          setView(null);
          setError(`Couldn't open ${currentPath}: ${errorMessage(e)}`);
        }
      });
    return () => {
      stale = true;
    };
  }, [currentPath, viewMode, dataVersion, scanning, rootPath]);

  const addRecent = (path: string) =>
    setRecent((prev) => {
      const next = [path, ...prev.filter((p) => p.toLowerCase() !== path.toLowerCase())].slice(0, 8);
      saveSetting("drivemole.recent", JSON.stringify(next));
      return next;
    });

  const scanDirectory = useCallback(async (path: string) => {
    if (scanningRef.current) return;
    scanningRef.current = true;
    setScanning(true);
    setProgress(null);
    setError(null);
    setNotice(null);

    try {
      const summary = await api.scan(path);
      setLastScan(summary);
      const isNewRoot = summary.root_path === summary.scanned_path;
      setRootPath(summary.root_path);
      setCurrentPath(path);
      if (isNewRoot) {
        setBackStack([]);
        addRecent(path);
      }
      setDataVersion((v) => v + 1);
      if (summary.inaccessible > 0) {
        setNotice(
          `${summary.inaccessible.toLocaleString()} folder${summary.inaccessible === 1 ? "" : "s"} couldn't be read (access denied), so totals may be low. Run DriveMole as administrator for complete results.`
        );
      }
    } catch (e) {
      const message = errorMessage(e);
      if (message !== "Scan cancelled") setError(`Scan failed: ${message}`);
    } finally {
      scanningRef.current = false;
      setScanning(false);
      setProgress(null);
    }
  }, []);

  /** Opens a folder from the current scan, or scans it if it's outside. */
  const navigate = useCallback(
    async (path: string, pushHistory = true) => {
      if (scanningRef.current) return;
      try {
        await api.getNode(path, 0);
      } catch (e) {
        if (errorMessage(e) === NOT_IN_SCAN) {
          await scanDirectory(path);
        } else {
          setError(errorMessage(e));
        }
        return;
      }
      setAnalysisTab("none");
      setSearchQuery("");
      if (pushHistory && currentPath && currentPath !== path) {
        setBackStack((prev) => [...prev, currentPath].slice(-100));
      }
      setCurrentPath(path);
    },
    [currentPath, scanDirectory]
  );

  const goBack = useCallback(() => {
    const previous = backStack[backStack.length - 1];
    if (!previous) return;
    setBackStack((prev) => prev.slice(0, -1));
    navigate(previous, false);
  }, [backStack, navigate]);

  const upPath = currentPath ? parentPath(currentPath) : null;
  const goUp = useCallback(() => {
    if (upPath) navigate(upPath);
  }, [upPath, navigate]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (pendingDelete) return;
      if (e.altKey && e.key === "ArrowLeft") {
        e.preventDefault();
        goBack();
      } else if (e.altKey && e.key === "ArrowUp") {
        e.preventDefault();
        goUp();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goBack, goUp, pendingDelete]);

  const selectFolder = async () => {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected === "string") scanDirectory(selected);
    } catch (e) {
      setError(`Couldn't open the folder picker: ${errorMessage(e)}`);
    }
  };

  const openInExplorer = useCallback(async (path: string) => {
    try {
      await api.openInExplorer(path);
    } catch (e) {
      setError(`Couldn't open Explorer: ${errorMessage(e)}`);
    }
  }, []);

  const confirmDelete = async (permanent: boolean) => {
    if (!pendingDelete) return;
    try {
      await api.deleteItem(pendingDelete.path, permanent);
      setPendingDelete(null);
      setDataVersion((v) => v + 1);
      api.getDrives().then(setDrives).catch(() => {});
    } catch (e) {
      setPendingDelete(null);
      setError(`Couldn't delete ${pendingDelete.name}: ${errorMessage(e)}`);
    }
  };

  const segments = currentPath ? pathSegments(currentPath) : [];
  const viewButtons: { mode: ViewMode; icon: typeof List; title: string }[] = [
    { mode: "tree", icon: List, title: "Tree view" },
    { mode: "treemap", icon: LayoutGrid, title: "Treemap view" },
    { mode: "sunburst", icon: PieChart, title: "Sunburst view" },
  ];
  const navButton =
    "p-1.5 rounded text-muted hover:text-fg hover:bg-raised disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted";

  return (
    <div className="h-screen flex flex-col bg-app text-fg">
      {/* Header */}
      <header className="bg-panel border-b border-line px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="" className="w-8 h-8" />
            <h1 className="text-xl font-bold">DriveMole</h1>
            <span className="text-xs text-subtle">Disk Analyzer</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
              className="p-2 rounded bg-raised hover:bg-line transition-colors"
              title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            >
              {theme === "dark" ? <Sun className="w-4 h-4 text-yellow-400" /> : <Moon className="w-4 h-4 text-muted" />}
            </button>

            <button
              onClick={selectFolder}
              disabled={scanning}
              className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-sm font-medium transition-colors text-white disabled:opacity-50"
            >
              <FolderOpen className="w-4 h-4" />
              Select Folder
            </button>

            {currentPath && (
              <button
                onClick={() => scanDirectory(currentPath)}
                disabled={scanning}
                className="flex items-center gap-2 px-3 py-1.5 bg-raised hover:bg-line rounded text-sm font-medium transition-colors disabled:opacity-50"
                title="Rescan this folder"
              >
                <RefreshCw className={`w-4 h-4 ${scanning ? "animate-spin" : ""}`} />
                Refresh
              </button>
            )}
          </div>
        </div>

        {/* Navigation and controls */}
        {currentPath && (
          <div className="mt-3 flex items-center gap-3">
            <div className="flex items-center gap-0.5">
              <button onClick={goBack} disabled={!backStack.length || scanning} className={navButton} title="Back (Alt+←)">
                <ArrowLeft className="w-4 h-4" />
              </button>
              <button onClick={goUp} disabled={!upPath || scanning} className={navButton} title="Up one level (Alt+↑)">
                <ArrowUp className="w-4 h-4" />
              </button>
            </div>

            <nav className="flex-1 min-w-0 flex items-center gap-0.5 bg-field border border-line rounded px-2 py-1 overflow-x-auto">
              <Folder className="w-4 h-4 text-yellow-500 flex-shrink-0 mr-1" />
              {segments.map((segment, i) => {
                const inScan = rootPath ? isWithin(segment.path, rootPath) : false;
                const isLast = i === segments.length - 1;
                return (
                  <span key={segment.path} className="flex items-center flex-shrink-0">
                    {i > 0 && <ChevronRight className="w-3.5 h-3.5 text-subtle" />}
                    <button
                      onClick={() => !isLast && navigate(segment.path)}
                      disabled={scanning || isLast}
                      className={`px-1 rounded text-sm whitespace-nowrap ${
                        isLast ? "text-fg font-medium cursor-default" : "hover:bg-raised"
                      } ${inScan ? "text-muted" : "text-subtle"}`}
                      title={inScan ? segment.path : `Scan ${segment.path}`}
                    >
                      {segment.label}
                    </button>
                  </span>
                );
              })}
            </nav>

            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-subtle" />
                <input
                  type="text"
                  placeholder="Filter this folder…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  disabled={viewMode !== "tree" || analysisTab !== "none"}
                  title={viewMode !== "tree" ? "Filtering works in the tree view" : undefined}
                  className="pl-8 pr-8 py-1.5 bg-field border border-line rounded text-sm w-48 text-fg placeholder:text-subtle focus:outline-none focus:border-blue-500 disabled:opacity-50"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-subtle hover:text-fg"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              <div className="flex items-center bg-field rounded border border-line overflow-hidden">
                {viewButtons.map(({ mode, icon: Icon, title }) => (
                  <button
                    key={mode}
                    onClick={() => {
                      setViewMode(mode);
                      setAnalysisTab("none");
                    }}
                    className={`p-1.5 ${
                      viewMode === mode && analysisTab === "none"
                        ? "bg-raised text-fg"
                        : "text-subtle hover:text-fg"
                    }`}
                    title={title}
                  >
                    <Icon className="w-4 h-4" />
                  </button>
                ))}
              </div>

              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortBy)}
                disabled={viewMode !== "tree" || analysisTab !== "none"}
                className="px-2 py-1.5 bg-field border border-line rounded text-sm text-fg focus:outline-none focus:border-blue-500 disabled:opacity-50"
              >
                <option value="size">Sort by Size</option>
                <option value="name">Sort by Name</option>
                <option value="files">Sort by Files</option>
              </select>
            </div>
          </div>
        )}
      </header>

      {/* Main content */}
      <main className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <aside className="w-64 bg-panel border-r border-line flex flex-col">
          <div className="p-3 border-b border-line">
            <h2 className="text-xs font-semibold text-muted uppercase tracking-wider">Drives</h2>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {drives.map((drive) => {
              const used = drive.total_space > 0 ? (drive.used_space / drive.total_space) * 100 : 0;
              return (
                <button
                  key={drive.mount_point}
                  onClick={() => scanDirectory(drive.mount_point)}
                  disabled={scanning}
                  className="w-full text-left p-2 hover:bg-raised rounded mb-1 transition-colors disabled:opacity-50 disabled:hover:bg-transparent"
                >
                  <div className="flex items-center gap-2">
                    <HardDrive className="w-4 h-4 text-blue-500" />
                    <span className="text-sm font-medium truncate">
                      {drive.name ? `${drive.name} (${drive.mount_point.replace(/\\$/, "")})` : drive.mount_point}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 bg-raised rounded-full overflow-hidden">
                    <div
                      className={`h-full ${used > 90 ? "bg-red-500" : "bg-blue-500"}`}
                      style={{ width: `${used}%` }}
                    />
                  </div>
                  <div className="flex justify-between mt-1 text-xs text-muted">
                    <span>{formatSize(drive.available_space)} free</span>
                    <span>{formatSize(drive.total_space)}</span>
                  </div>
                </button>
              );
            })}
          </div>

          {view && (
            <>
              <div className="p-3 border-t border-line">
                <h2 className="text-xs font-semibold text-muted uppercase tracking-wider">Analysis</h2>
              </div>
              <div className="p-2">
                {(
                  [
                    ["largest", FileText, "Top 100 Largest Files"],
                    ["mostFiles", Files, "Folders with Most Files"],
                  ] as const
                ).map(([tab, Icon, label]) => (
                  <button
                    key={tab}
                    onClick={() => setAnalysisTab(analysisTab === tab ? "none" : tab)}
                    className={`w-full text-left p-2 rounded mb-1 transition-colors flex items-center gap-2 ${
                      analysisTab === tab ? "bg-blue-600 text-white" : "hover:bg-raised"
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span className="text-sm">{label}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          {recent.length > 0 && (
            <>
              <div className="p-3 border-t border-line">
                <h2 className="text-xs font-semibold text-muted uppercase tracking-wider">Recent</h2>
              </div>
              <div className="overflow-y-auto p-2 max-h-48">
                {recent.slice(0, 5).map((path) => (
                  <button
                    key={path}
                    onClick={() => scanDirectory(path)}
                    disabled={scanning}
                    className="w-full text-left p-2 hover:bg-raised rounded mb-1 transition-colors disabled:opacity-50"
                    title={path}
                  >
                    <div className="flex items-center gap-2">
                      <Folder className="w-4 h-4 text-yellow-500 flex-shrink-0" />
                      <span className="text-sm truncate">{path}</span>
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
        </aside>

        {/* Content area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {error && (
            <div className="bg-red-500/10 border-b border-red-500/30 px-4 py-2 flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span className="flex-1">{error}</span>
              <button onClick={() => setError(null)} className="hover:opacity-70" title="Dismiss">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
          {notice && !scanning && (
            <div className="bg-amber-500/10 border-b border-amber-500/30 px-4 py-2 flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span className="flex-1">{notice}</span>
              <button onClick={() => setNotice(null)} className="hover:opacity-70" title="Dismiss">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {scanning && (
            <div className="bg-panel border-b border-line px-4 py-3">
              <div className="flex items-center gap-3">
                <RefreshCw className="w-4 h-4 animate-spin text-blue-500" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm">
                    Scanning… {(progress?.files_scanned ?? 0).toLocaleString()} files ·{" "}
                    {formatSize(progress?.total_size ?? 0)}
                  </div>
                  <div className="text-xs text-subtle truncate">{progress?.current_path ?? ""}</div>
                </div>
                <button
                  onClick={() => api.cancelScan()}
                  className="px-3 py-1 rounded text-sm bg-raised hover:bg-line"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {!view && !scanning && (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <img src="/logo.png" alt="DriveMole" className="w-32 h-32 mx-auto mb-4" />
                <h2 className="text-xl font-semibold text-muted mb-2">Welcome to DriveMole</h2>
                <p className="text-subtle mb-4">Select a drive or folder to analyze disk usage</p>
                <button
                  onClick={selectFolder}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded font-medium transition-colors text-white"
                >
                  Select Folder
                </button>
              </div>
            </div>
          )}

          {view && !scanning && (
            <div className="flex-1 overflow-hidden flex flex-col">
              {/* Summary bar */}
              <div className="bg-panel border-b border-line px-4 py-2 flex items-center gap-6 text-sm">
                <div className="flex items-center gap-2" title={`${view.logical_size.toLocaleString()} bytes actual size`}>
                  <span className="text-xs text-subtle">Size on disk:</span>
                  <span className="font-semibold">{formatSize(view.size)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-subtle">Files:</span>
                  <span className="font-semibold">{(view.file_count ?? 0).toLocaleString()}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-subtle">Folders:</span>
                  <span className="font-semibold">{(view.dir_count ?? 0).toLocaleString()}</span>
                </div>
                {lastScan && (
                  <span className="text-xs text-subtle">
                    Scanned in {(lastScan.elapsed_ms / 1000).toFixed(1)}s
                  </span>
                )}
                {analysisTab !== "none" && (
                  <button
                    onClick={() => setAnalysisTab("none")}
                    className="ml-auto text-xs text-blue-500 hover:text-blue-400"
                  >
                    ← Back to folder view
                  </button>
                )}
              </div>

              {analysisTab !== "none" && (
                <AnalysisList
                  kind={analysisTab}
                  path={view.path}
                  dataVersion={dataVersion}
                  onNavigate={navigate}
                  onDelete={setPendingDelete}
                  onOpenInExplorer={openInExplorer}
                />
              )}

              {analysisTab === "none" && viewMode === "tree" && (
                <TreeView
                  root={view}
                  sortBy={sortBy}
                  filter={searchQuery}
                  dataVersion={dataVersion}
                  onNavigate={navigate}
                  onDelete={setPendingDelete}
                  onOpenInExplorer={openInExplorer}
                />
              )}

              {analysisTab === "none" && viewMode === "treemap" && (
                <TreeMap data={view} onNavigate={navigate} />
              )}

              {analysisTab === "none" && viewMode === "sunburst" && (
                <SunburstChart data={view} onNavigate={navigate} onUp={upPath ? goUp : null} />
              )}
            </div>
          )}
        </div>
      </main>

      {pendingDelete && (
        <DeleteDialog
          entry={pendingDelete}
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}

export default App;
