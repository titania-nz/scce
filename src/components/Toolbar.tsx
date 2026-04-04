'use client';

interface ToolbarProps {
  filename: string | null;
  isDirty: boolean;
  isSaving: boolean;
  mobileView: 'edit' | 'preview';
  onMobileViewChange: (view: 'edit' | 'preview') => void;
  onSave: () => void;
  onToggleSidebar: () => void;
}

export default function Toolbar({
  filename,
  isDirty,
  isSaving,
  mobileView,
  onMobileViewChange,
  onSave,
  onToggleSidebar,
}: ToolbarProps) {
  return (
    <div className="flex items-center gap-2 px-3 h-12 bg-gray-800 border-b border-gray-700 shrink-0">
      {/* Hamburger — visible on mobile only */}
      <button
        onClick={onToggleSidebar}
        className="md:hidden text-gray-400 hover:text-white p-1 rounded transition-colors"
        aria-label="Toggle sidebar"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {/* Filename */}
      <span className="flex-1 text-sm text-gray-300 truncate min-w-0">
        {filename ? (
          <>
            {filename}
            {isDirty && !isSaving && (
              <span className="ml-1.5 text-xs text-yellow-400">●</span>
            )}
          </>
        ) : (
          <span className="text-gray-500">No file selected</span>
        )}
        {isSaving && (
          <span className="ml-2 text-xs text-gray-400">Saving...</span>
        )}
      </span>

      {/* Mobile Edit/Preview tabs */}
      <div className="md:hidden flex rounded overflow-hidden border border-gray-600">
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

      {/* Save button */}
      {filename && (
        <button
          onClick={onSave}
          disabled={!isDirty || isSaving}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-xs rounded transition-colors shrink-0"
          title="Save (Ctrl+S)"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
          </svg>
          Save
        </button>
      )}
    </div>
  );
}
