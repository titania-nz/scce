export interface SidebarTreeFileLike {
  file: {
    name: string;
  };
  baseName: string;
}

export interface SidebarTreeNode<TFile extends SidebarTreeFileLike = SidebarTreeFileLike> {
  path: string;
  name: string;
  folders: SidebarTreeNode<TFile>[];
  files: TFile[];
}

export interface SidebarTreeData<TFile extends SidebarTreeFileLike = SidebarTreeFileLike> {
  folders: SidebarTreeNode<TFile>[];
  rootFiles: TFile[];
}

export interface SidebarTreeFilterResult<TFile extends SidebarTreeFileLike = SidebarTreeFileLike> {
  tree: SidebarTreeData<TFile>;
  matchCount: number;
  matchedFolderPaths: Set<string>;
  matchedFiles: Set<string>;
  autoExpandedFolderPaths: Set<string>;
}

export function getAncestorFolderPaths(path: string): string[] {
  const normalized = path.replace(/^\/+/, '').trim();
  if (!normalized) return [];
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length <= 1) return [];

  const ancestors: string[] = [];
  for (let i = 1; i < parts.length; i += 1) {
    ancestors.push(parts.slice(0, i).join('/'));
  }
  return ancestors;
}

export function parseCollapsedFoldersState(raw: string | null): Record<string, boolean> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return {};
    const next: Record<string, boolean> = {};
    Object.entries(parsed).forEach(([key, value]) => {
      if (typeof key === 'string' && typeof value === 'boolean') {
        next[key] = value;
      }
    });
    return next;
  } catch {
    return {};
  }
}

export function serializeCollapsedFoldersState(state: Record<string, boolean>): string {
  return JSON.stringify(state);
}

function matchesQuery(value: string, query: string): boolean {
  return value.toLowerCase().includes(query);
}

export function filterSidebarTree<TFile extends SidebarTreeFileLike>(
  tree: SidebarTreeData<TFile>,
  query: string,
  selectedFile: string | null,
): SidebarTreeFilterResult<TFile> {
  const normalizedQuery = query.trim().toLowerCase();
  const matchedFolderPaths = new Set<string>();
  const matchedFiles = new Set<string>();
  const autoExpandedFolderPaths = new Set<string>();
  const selectedAncestors = selectedFile ? new Set(getAncestorFolderPaths(selectedFile)) : new Set<string>();

  if (!normalizedQuery) {
    selectedAncestors.forEach((path) => autoExpandedFolderPaths.add(path));
    return {
      tree,
      matchCount: 0,
      matchedFolderPaths,
      matchedFiles,
      autoExpandedFolderPaths,
    };
  }

  function trackFolderPath(path: string) {
    autoExpandedFolderPaths.add(path);
    getAncestorFolderPaths(path).forEach((ancestor) => autoExpandedFolderPaths.add(ancestor));
  }

  function doesFileMatch(file: TFile): boolean {
    const matched = matchesQuery(file.baseName, normalizedQuery) || matchesQuery(file.file.name, normalizedQuery);
    if (matched) {
      matchedFiles.add(file.file.name);
      getAncestorFolderPaths(file.file.name).forEach((ancestor) => autoExpandedFolderPaths.add(ancestor));
    }
    return matched;
  }

  function visitNode(node: SidebarTreeNode<TFile>): SidebarTreeNode<TFile> | null {
    const folderMatched = matchesQuery(node.name, normalizedQuery) || matchesQuery(node.path, normalizedQuery);
    if (folderMatched) {
      matchedFolderPaths.add(node.path);
      trackFolderPath(node.path);
    }

    const nextFolders = node.folders
      .map((child) => visitNode(child))
      .filter((child): child is SidebarTreeNode<TFile> => Boolean(child));
    const nextFiles = node.files.filter((file) => {
      if (selectedFile && file.file.name === selectedFile) return true;
      return doesFileMatch(file);
    });

    if (nextFolders.length > 0 || nextFiles.length > 0 || folderMatched || selectedAncestors.has(node.path)) {
      return {
        ...node,
        folders: nextFolders,
        files: nextFiles,
      };
    }
    return null;
  }

  const nextTree: SidebarTreeData<TFile> = {
    folders: tree.folders
      .map((folder) => visitNode(folder))
      .filter((folder): folder is SidebarTreeNode<TFile> => Boolean(folder)),
    rootFiles: tree.rootFiles.filter((file) => {
      if (selectedFile && file.file.name === selectedFile) return true;
      return doesFileMatch(file);
    }),
  };

  selectedAncestors.forEach((path) => autoExpandedFolderPaths.add(path));

  return {
    tree: nextTree,
    matchCount: matchedFolderPaths.size + matchedFiles.size,
    matchedFolderPaths,
    matchedFiles,
    autoExpandedFolderPaths,
  };
}
