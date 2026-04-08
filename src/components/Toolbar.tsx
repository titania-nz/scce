'use client';

import { domId, domIdSuffix } from '@/lib/domId';

interface ToolbarProps {
  filename: string | null;
  isDirty: boolean;
  isSaving: boolean;
  lastCheckpointAt: string | null;
  isSidebarOpen: boolean;
  isInspectorOpen: boolean;
  isOffline: boolean;
  queuedSyncCount: number;
  mobileView: 'edit' | 'preview';
  workspaceMode: 'editor' | 'compare' | 'documents';
  onMobileViewChange: (view: 'edit' | 'preview') => void;
  onSaveCheckpoint: () => void;
  canSaveCheckpoint: boolean;
  checkpointBlockReason?: string;
  onContinueWorkingDraft: () => void;
  onOpenRecoveryPanel: () => void;
  onOpenStorageHealth: () => void;
  onExportBackup: () => void;
  onToggleSidebar: () => void;
  onToggleInspector: () => void;
  onWorkspaceModeChange: (mode: 'editor' | 'compare' | 'documents') => void;
  isUtilitiesOpen: boolean;
  onToggleUtilities: () => void;
}

// Helper function: keeps a small, testable transformation isolated from UI side effects.
function formatCheckpointTimestamp(timestamp: string | null): string {
  if (!timestamp) return 'No checkpoint saved yet';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp));
}

// Main component export: this is the entry point rendered by parent routes/components.
export default function Toolbar({
  filename,
  isDirty,
  isSaving,
  lastCheckpointAt,
  isSidebarOpen,
  isInspectorOpen,
  isOffline,
  queuedSyncCount,
  mobileView,
  workspaceMode,
  onMobileViewChange,
  onSaveCheckpoint,
  canSaveCheckpoint,
  checkpointBlockReason,
  onContinueWorkingDraft,
  onOpenRecoveryPanel,
  onOpenStorageHealth,
  onExportBackup,
  onToggleSidebar,
  onToggleInspector,
  onWorkspaceModeChange,
  isUtilitiesOpen,
  onToggleUtilities,
}: ToolbarProps) {
  const sidebarToggleLabel = isSidebarOpen ? 'Collapse sidebar' : 'Expand sidebar';
  const inspectorToggleLabel = isInspectorOpen ? 'Hide inspector' : 'Show inspector';

  return (
    <div id="toolbar-div-001" className="flex items-center gap-2 px-3 h-12 bg-gray-800 border-b border-gray-700 shrink-0">
      <button
        onClick={onToggleSidebar}
        className="flex items-center gap-2 rounded border border-gray-700 bg-gray-900/50 px-2 py-1.5 text-gray-300 transition-colors hover:bg-gray-700 hover:text-white shrink-0"
        aria-label={sidebarToggleLabel}
        aria-expanded={isSidebarOpen}
        title={sidebarToggleLabel}
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
        <span className="hidden md:inline text-xs font-medium">Files</span>
      </button>

      {/* Filename + status */}
      <span className="flex-1 text-sm text-gray-300 truncate min-w-0">
        {filename ? (
          <>
            {filename}
            <span className={`ml-2 text-xs ${isDirty ? 'text-yellow-300' : 'text-emerald-300'}`}>
              {isDirty ? 'Working draft (unsaved checkpoint)' : 'Checkpoint up to date'}
            </span>
            <span className="ml-2 text-xs text-gray-400">
              Last checkpoint: {formatCheckpointTimestamp(lastCheckpointAt)}
            </span>
          </>
        ) : (
          <span className="text-gray-500">No file selected</span>
        )}
        {isSaving && (
          <span className="ml-2 text-xs text-gray-400">Saving draft...</span>
        )}
      </span>

      <span className={`text-[11px] px-2 py-1 rounded border shrink-0 ${isOffline ? 'border-amber-500/70 text-amber-300 bg-amber-950/40' : 'border-emerald-500/50 text-emerald-300 bg-emerald-950/30'}`}>
        {isOffline ? 'Offline' : 'Online'}
        {queuedSyncCount > 0 ? ` • ${queuedSyncCount} queued` : ''}
      </span>

      <div id="toolbar-div-002" className="hidden md:flex items-center gap-1 rounded border border-gray-700 bg-gray-900/50 p-1 shrink-0">
        {(['editor', 'compare', 'documents'] as const).map((mode) => (
          <button
            key={mode}
            onClick={() => onWorkspaceModeChange(mode)}
            className={`px-2.5 py-1 text-xs rounded transition-colors ${
              workspaceMode === mode
                ? 'bg-blue-600 text-white'
                : 'text-gray-300 hover:bg-gray-700'
            }`}
          >
            {mode === 'editor' ? 'Editor' : mode === 'compare' ? 'Compare' : 'Documents'}
          </button>
        ))}
      </div>

      <button
        onClick={onToggleInspector}
        className={`hidden lg:inline-flex px-2.5 py-1 text-xs rounded transition-colors shrink-0 ${
          workspaceMode !== 'editor'
            ? 'pointer-events-none opacity-50'
            : isInspectorOpen
              ? 'bg-blue-600 text-white'
              : 'bg-gray-700 text-gray-200 hover:bg-gray-600'
        }`}
        disabled={workspaceMode !== 'editor'}
        title={workspaceMode !== 'editor' ? 'Inspector is only available in Editor view' : inspectorToggleLabel}
      >
        Inspector
      </button>

      <div id="toolbar-div-003" className="relative shrink-0">
        <button
          onClick={onToggleUtilities}
          className="px-2.5 py-1 text-xs rounded bg-gray-700 text-gray-200 hover:bg-gray-600"
        >
          Utilities
        </button>
        {isUtilitiesOpen && (
          <div id="toolbar-div-004" className="absolute right-0 top-9 z-30 w-44 rounded border border-gray-700 bg-gray-900 p-1 shadow-xl">
            <button onClick={onOpenRecoveryPanel} className="block w-full rounded px-2 py-1.5 text-left text-xs text-gray-200 hover:bg-gray-800">Restore drafts</button>
            <button onClick={onOpenStorageHealth} className="block w-full rounded px-2 py-1.5 text-left text-xs text-gray-200 hover:bg-gray-800">Storage health</button>
            <button onClick={onExportBackup} className="block w-full rounded px-2 py-1.5 text-left text-xs text-gray-200 hover:bg-gray-800">Export backup</button>
          </div>
        )}
      </div>

      {/* Mobile Edit/Preview tabs */}
      <div id="toolbar-div-005" className={`md:hidden flex rounded overflow-hidden border border-gray-600 ${workspaceMode !== 'editor' ? 'hidden' : ''}`}>
        <button
          onClick={() => onMobileViewChange('edit')}
          className={`px-3 py-1 text-xs transition-colors ${
            mobileView === 'edit'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
          }`}
        >
          Edit
        </button>
        <button
          onClick={() => onMobileViewChange('preview')}
          className={`px-3 py-1 text-xs transition-colors ${
            mobileView === 'preview'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
          }`}
        >
          Preview
        </button>
      </div>

      {/* Working draft actions */}
      {filename && workspaceMode === 'editor' && (
        <>
          <button
            onClick={onContinueWorkingDraft}
            disabled={!isDirty || isSaving}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-700 disabled:text-gray-500 text-gray-200 text-xs rounded transition-colors shrink-0"
            title="Keep edits in working draft without creating a checkpoint revision"
          >
            Continue editing working draft
          </button>

          <button
            onClick={onSaveCheckpoint}
            disabled={!canSaveCheckpoint}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-xs rounded transition-colors shrink-0"
            title={checkpointBlockReason ?? 'Save checkpoint revision (Ctrl+S)'}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
            </svg>
            Save checkpoint revision
          </button>
        </>
      )}
    </div>
  );
}
