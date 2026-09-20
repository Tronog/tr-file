import { Service } from '@angular/core';
import type { MockFileDetails, MockFileNode } from './mock-data.model';

/**
 * The mocked file system.
 *
 * Holds data only — no behaviour beyond the lookups a backend endpoint would
 * otherwise answer. When the Express backend's `/api/files` endpoints are wired
 * up, this service is the only thing that changes: the tree, the listings and
 * the details all keep their shapes.
 */
@Service()
export class MockDataFileSystemService {
  /** Root of the workspace shown in the explorer. */
  readonly workspaceName = 'tr-file';

  /** Absolute path of the workspace root, shown in the details sidebar. */
  readonly workspacePath = '/data/src/tr-file';

  readonly tree: readonly MockFileNode[] = [
    {
      id: 'prj',
      name: 'prj',
      kind: 'directory',
      size: null,
      modified: '2026-09-20T11:44:00Z',
      children: [
        {
          id: 'prj/backend',
          name: 'backend',
          kind: 'directory',
          size: null,
          modified: '2026-09-20T12:58:00Z',
          itemCount: 12,
          children: [
            { id: 'prj/backend/src', name: 'src', kind: 'directory', size: null, modified: '2026-09-20T12:58:00Z', itemCount: 9 },
            { id: 'prj/backend/package.json', name: 'package.json', kind: 'file', size: 780, modified: '2026-09-20T12:58:00Z' },
          ],
        },
        {
          id: 'prj/frontend',
          name: 'frontend',
          kind: 'directory',
          size: null,
          modified: '2026-09-20T13:04:00Z',
          children: [
            { id: 'prj/frontend/src', name: 'src', kind: 'directory', size: null, modified: '2026-09-20T13:04:00Z', itemCount: 8 },
            { id: 'prj/frontend/node_modules', name: 'node_modules', kind: 'directory', size: null, modified: '2026-09-18T22:40:00Z', itemCount: 412, decoration: 'ignored' },
            { id: 'prj/frontend/package.json', name: 'package.json', kind: 'file', size: 942, modified: '2026-09-20T13:10:00Z', decoration: 'modified' },
            { id: 'prj/frontend/tsconfig.json', name: 'tsconfig.json', kind: 'file', size: 1_204, modified: '2026-09-19T16:20:00Z' },
          ],
        },
        { id: 'prj/libs', name: 'libs', kind: 'directory', size: null, modified: '2026-09-19T09:11:00Z', itemCount: 1 },
        { id: 'prj/compose.dev.yaml', name: 'compose.dev.yaml', kind: 'file', size: 1_843, modified: '2026-09-20T11:02:00Z' },
        { id: 'prj/compose.prod.yaml', name: 'compose.prod.yaml', kind: 'file', size: 2_150, modified: '2026-09-20T11:02:00Z' },
        { id: 'prj/package.json', name: 'package.json', kind: 'file', size: 942, modified: '2026-09-20T13:10:00Z', decoration: 'modified' },
        { id: 'prj/pnpm-lock.yaml', name: 'pnpm-lock.yaml', kind: 'file', size: 325_632, modified: '2026-09-20T11:44:00Z' },
        { id: 'prj/pnpm-workspace.yaml', name: 'pnpm-workspace.yaml', kind: 'file', size: 206, modified: '2026-09-20T11:44:00Z' },
        { id: 'prj/tsconfig.base.json', name: 'tsconfig.base.json', kind: 'file', size: 512, modified: '2026-09-19T16:20:00Z' },
      ],
    },
    {
      id: 'docs',
      name: 'docs',
      kind: 'directory',
      size: null,
      modified: '2026-09-20T13:11:00Z',
      children: [
        {
          id: 'docs/ai',
          name: 'ai',
          kind: 'directory',
          size: null,
          modified: '2026-09-20T13:09:00Z',
          itemCount: 5,
          children: [
            { id: 'docs/ai/ANGULAR.md', name: 'ANGULAR.md', kind: 'file', size: 1_024, modified: '2026-09-20T13:09:00Z' },
            { id: 'docs/ai/CLAUDE.md', name: 'CLAUDE.md', kind: 'file', size: 1_638, modified: '2026-09-20T13:09:00Z' },
            { id: 'docs/ai/DOCKER.md', name: 'DOCKER.md', kind: 'file', size: 3_277, modified: '2026-09-20T13:09:00Z' },
            { id: 'docs/ai/EXPRESS.md', name: 'EXPRESS.md', kind: 'file', size: 184, modified: '2026-09-20T13:09:00Z' },
            { id: 'docs/ai/VSCODE-UI.md', name: 'VSCODE-UI.md', kind: 'file', size: 45_056, modified: '2026-09-20T13:09:00Z' },
          ],
        },
        {
          id: 'docs/prd',
          name: 'prd',
          kind: 'directory',
          size: null,
          modified: '2026-09-20T13:11:00Z',
          children: [
            { id: 'docs/prd/001.md', name: '001.md', kind: 'file', size: 1_126, modified: '2026-09-20T13:11:00Z' },
            { id: 'docs/prd/002.md', name: '002.md', kind: 'file', size: 612, modified: '2026-09-20T13:12:00Z', decoration: 'untracked' },
          ],
        },
        { id: 'docs/NOTES.md', name: 'NOTES.md', kind: 'file', size: 2_048, modified: '2026-09-19T18:02:00Z', cut: true },
      ],
    },
    { id: 'README.md', name: 'README.md', kind: 'file', size: 3_482, modified: '2026-09-20T10:15:00Z' },
    { id: '.gitignore', name: '.gitignore', kind: 'file', size: 128, modified: '2026-09-18T20:00:00Z', decoration: 'ignored' },
  ];

  /**
   * Directory listings keyed by path. Kept separate from `tree` because a
   * backend would serve them from a different endpoint, and because a panel can
   * list a directory the tree has never expanded.
   */
  readonly listings: Readonly<Record<string, readonly MockFileNode[]>> = {
    prj: this.childrenOf('prj'),
    'docs/ai': this.childrenOf('docs/ai'),
    'assets': [
      { id: 'assets/logo.svg', name: 'logo.svg', kind: 'file', size: 4_096, modified: '2026-09-17T09:30:00Z' },
      { id: 'assets/hero.png', name: 'hero.png', kind: 'file', size: 262_144, modified: '2026-09-17T09:31:00Z' },
      { id: 'assets/icon-512.png', name: 'icon-512.png', kind: 'file', size: 65_536, modified: '2026-09-17T09:31:00Z' },
      { id: 'assets/theme.css', name: 'theme.css', kind: 'file', size: 8_192, modified: '2026-09-18T14:02:00Z' },
      { id: 'assets/fonts', name: 'fonts', kind: 'directory', size: null, modified: '2026-09-16T11:00:00Z', itemCount: 6 },
      { id: 'assets/flags', name: 'flags', kind: 'directory', size: null, modified: '2026-09-16T11:00:00Z', itemCount: 24 },
    ],
  };

  /** Details for the entries the mock selects; keyed by entry id. */
  readonly details: Readonly<Record<string, MockFileDetails>> = {
    'docs/prd/001.md': {
      id: 'docs/prd/001.md',
      location: '/data/src/tr-file/docs/prd',
      sizeBytes: 1_126,
      sizeOnDiskBytes: 4_096,
      created: '2026-09-20T12:58:00Z',
      modified: '2026-09-20T13:11:00Z',
      accessed: '2026-09-20T13:44:00Z',
      owner: 'user',
      group: 'user',
      inode: 4_718_902,
      checksum: 'sha256:9f2a…c41d',
      mode: '0644',
      tags: [
        { id: 'spec', label: 'spec', color: '#3b8eea' },
        { id: 'design', label: 'design', color: '#73c991' },
        { id: 'in-review', label: 'in-review', color: '#e2c08d' },
      ],
      git: {
        status: 'Modified',
        branch: 'main',
        lastCommit: 'docs: add PRD 001 · 2 h ago',
        decoration: 'modified',
      },
    },
  };

  /** Looks up one node anywhere in the tree. */
  find(id: string): MockFileNode | undefined {
    const walk = (nodes: readonly MockFileNode[]): MockFileNode | undefined => {
      for (const node of nodes) {
        if (node.id === id) {
          return node;
        }
        const hit = node.children ? walk(node.children) : undefined;
        if (hit) {
          return hit;
        }
      }
      return undefined;
    };
    return walk(this.tree);
  }

  /** Contents of one directory, empty when the path is unknown. */
  list(path: string): readonly MockFileNode[] {
    return this.listings[path] ?? this.childrenOf(path);
  }

  private childrenOf(id: string): readonly MockFileNode[] {
    return this.find(id)?.children ?? [];
  }
}
