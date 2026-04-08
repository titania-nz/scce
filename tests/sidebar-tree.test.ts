import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterSidebarTree,
  getAncestorFolderPaths,
  parseCollapsedFoldersState,
  serializeCollapsedFoldersState,
  type SidebarTreeData,
} from '../src/lib/sidebarTree.ts';

interface TestFile {
  file: { name: string };
  baseName: string;
}

function makeTree(): SidebarTreeData<TestFile> {
  return {
    folders: [
      {
        path: 'alpha',
        name: 'alpha',
        folders: [
          {
            path: 'alpha/chapter-1',
            name: 'chapter-1',
            folders: [],
            files: [{ file: { name: 'alpha/chapter-1/scene-a.md' }, baseName: 'scene-a.md' }],
          },
        ],
        files: [],
      },
      {
        path: 'beta',
        name: 'beta',
        folders: [],
        files: [{ file: { name: 'beta/notes.md' }, baseName: 'notes.md' }],
      },
    ],
    rootFiles: [{ file: { name: 'root.md' }, baseName: 'root.md' }],
  };
}

test('filterSidebarTree keeps only matching branches and ancestors', () => {
  const result = filterSidebarTree(makeTree(), 'scene-a', null);
  assert.equal(result.tree.folders.length, 1);
  assert.equal(result.tree.folders[0].path, 'alpha');
  assert.equal(result.tree.folders[0].folders.length, 1);
  assert.equal(result.tree.folders[0].folders[0].path, 'alpha/chapter-1');
  assert.equal(result.tree.folders[0].folders[0].files.length, 1);
  assert.equal(result.tree.folders[0].folders[0].files[0].file.name, 'alpha/chapter-1/scene-a.md');
  assert.equal(result.tree.rootFiles.length, 0);
  assert.equal(result.matchCount, 1);
  assert.equal(result.autoExpandedFolderPaths.has('alpha'), true);
  assert.equal(result.autoExpandedFolderPaths.has('alpha/chapter-1'), true);
});

test('getAncestorFolderPaths supports reveal-selected ancestry', () => {
  assert.deepEqual(getAncestorFolderPaths('a/b/c.md'), ['a', 'a/b']);
  assert.deepEqual(getAncestorFolderPaths('single.md'), []);
});

test('collapsed-folder persistence round-trip is stable and safe', () => {
  const encoded = serializeCollapsedFoldersState({ alpha: true, beta: false });
  assert.deepEqual(parseCollapsedFoldersState(encoded), { alpha: true, beta: false });
  assert.deepEqual(parseCollapsedFoldersState('{"alpha":"bad"}'), {});
  assert.deepEqual(parseCollapsedFoldersState('not-json'), {});
});
