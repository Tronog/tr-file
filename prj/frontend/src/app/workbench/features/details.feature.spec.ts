import { TestBed } from '@angular/core/testing';
import { WorkbenchService } from '../workbench.service';

describe('DetailsFeature', () => {
  let workbench: WorkbenchService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    workbench = TestBed.inject(WorkbenchService);
  });

  it('describes the entry selected at start-up', () => {
    expect(workbench.selectedEntryId()).toBe('docs/prd/001.md');
    expect(workbench.detailsFt.hasDetails()).toBe(true);
    expect(workbench.detailsFt.preview()).toMatchObject({ title: '001.md', subtitle: 'MD · 1.1 KB', icon: 'file', tint: 'md' });
  });

  it('parses the octal mode into a read/write/execute matrix', () => {
    const permissions = workbench.detailsFt.permissions();

    expect(permissions?.mode).toBe('0644');
    expect(permissions?.owner).toEqual({ read: true, write: true, execute: false });
    expect(permissions?.group).toEqual({ read: true, write: false, execute: false });
    expect(permissions?.others).toEqual({ read: true, write: false, execute: false });
  });

  it('lists the file properties, formatted for display', () => {
    const byLabel = new Map(workbench.detailsFt.properties().map((property) => [property.label, property.value]));

    expect(byLabel.get('Location')).toBe('/data/src/tr-file/docs/prd');
    expect(byLabel.get('Size')).toBe('1,126 bytes (1.1 KB)');
    expect(byLabel.get('On disk')).toBe('4.0 KB');
    expect(byLabel.get('Modified')).toBe('Sep 20, 2026 13:11');
    expect(byLabel.get('Owner')).toBe('user : user');
  });

  it('exposes the git facts, toning the modified status', () => {
    expect(workbench.detailsFt.git()).toEqual([
      { label: 'Status', value: 'Modified', tone: 'modified' },
      { label: 'Branch', value: 'main' },
      { label: 'Last commit', value: 'docs: add PRD 001 · 2 h ago' },
    ]);
    expect(workbench.detailsFt.tags().map((tag) => tag.id)).toEqual(['spec', 'design', 'in-review']);
  });

  describe('when the selected entry has no details', () => {
    beforeEach(() => workbench.selectedEntryId.set('README.md'));

    it('reports that nothing is known and empties the lists', () => {
      expect(workbench.detailsFt.hasDetails()).toBe(false);
      expect(workbench.detailsFt.properties()).toEqual([]);
      expect(workbench.detailsFt.git()).toEqual([]);
      expect(workbench.detailsFt.tags()).toEqual([]);
      expect(workbench.detailsFt.permissions()).toBeUndefined();
    });

    it('still previews the entry itself, which the tree knows about', () => {
      expect(workbench.detailsFt.preview()).toMatchObject({ title: 'README.md', subtitle: 'MD · 3.4 KB' });
    });

    it('has no preview at all when the selection is unknown', () => {
      workbench.selectedEntryId.set('nope/missing.txt');
      expect(workbench.detailsFt.preview()).toBeUndefined();
      expect(workbench.detailsFt.properties()).toEqual([]);
    });

    it('previews a directory as a folder', () => {
      workbench.selectedEntryId.set('prj/libs');
      expect(workbench.detailsFt.preview()).toMatchObject({ subtitle: 'Folder', icon: 'folder', tint: 'folder' });
    });
  });

  it('offers the static "Open with" rows', () => {
    expect(workbench.detailsFt.openWith.map((item) => item.id)).toEqual(['preview', 'editor', 'terminal', 'reveal']);
  });
});
