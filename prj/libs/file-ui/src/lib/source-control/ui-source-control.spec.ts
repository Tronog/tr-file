import { TestBed } from '@angular/core/testing';
import { UiDocumentView } from '@tr-file/ui';
import { UiSourceControl } from '../../public-api';
import type { UiDocumentModel } from '@tr-file/ui';
import type { UiScmActionEvent, UiScmModel } from '../../public-api';

/** PRD 011, §1 — the library's source control view and the diff document. */

const SCM: UiScmModel = {
  branch: 'main',
  branchTitle: 'main — Checkout to another branch, or create one',
  sync: '1↓ 2↑',
  syncTitle: 'Synchronize Changes',
  message: 'Fix',
  messagePlaceholder: "Message (Ctrl+Enter to commit on 'main')",
  commitLabel: 'Commit',
  canCommit: true,
  groups: [
    {
      id: 'unstaged',
      label: 'Changes',
      actions: [{ id: 'stage-all', label: 'Stage All Changes', icon: 'plus' }],
      items: [
        {
          id: 'unstaged:src/app.ts',
          name: 'app.ts',
          description: 'src',
          icon: 'file',
          tint: 'ts',
          letter: 'M',
          tone: 'modified',
          title: 'src/app.ts • Modified',
          actions: [{ id: 'stage', label: 'Stage Changes', icon: 'plus' }],
        },
      ],
    },
  ],
  commits: [{ id: 'abc', subject: 'First', short: 'abc1234', detail: 'Ana · 2 hours ago', refs: ['main'] }],
};

describe('UiSourceControl', () => {
  function render(scm: UiScmModel = SCM) {
    const fixture = TestBed.createComponent(UiSourceControl);
    fixture.componentRef.setInput('scm', scm);
    fixture.detectChanges();
    return { fixture, host: fixture.nativeElement as HTMLElement, component: fixture.componentInstance };
  }

  it('draws the branch, the sync counts, the changes and the commits', () => {
    const { host } = render();
    expect(host.querySelector('.branch')?.textContent?.trim()).toBe('main');
    expect(host.querySelector('.sync')?.getAttribute('aria-label')).toBe('Synchronize Changes');
    expect(host.querySelector('.message')).toHaveProperty('value', 'Fix');
    expect(host.querySelector('.item-open')?.getAttribute('aria-label')).toBe('src/app.ts • Modified');
    expect(host.querySelector('.letter')?.textContent).toBe('M');
    expect(host.querySelector('.count')?.textContent).toBe('1');
    expect(host.querySelector('.commit-subject')?.textContent).toContain('First');
    expect(host.querySelector('.ref')?.textContent).toBe('main');
  });

  it('reports rows, their buttons and the group buttons, naming what they are for', () => {
    const { host, component } = render();
    const opened: string[] = [];
    const actions: UiScmActionEvent[] = [];
    const groups: UiScmActionEvent[] = [];
    component.itemOpen.subscribe((id) => opened.push(id));
    component.itemAction.subscribe((event) => actions.push(event));
    component.groupAction.subscribe((event) => groups.push(event));

    host.querySelector<HTMLButtonElement>('.item-open')?.click();
    const stage = host.querySelector<HTMLButtonElement>('.item .icon-btn');
    expect(stage?.getAttribute('aria-label')).toBe('Stage Changes: app.ts');
    stage?.click();
    host.querySelector<HTMLButtonElement>('.group-actions .icon-btn')?.click();

    expect(opened).toEqual(['unstaged:src/app.ts']);
    expect(actions).toEqual([{ targetId: 'unstaged:src/app.ts', actionId: 'stage' }]);
    expect(groups).toEqual([{ targetId: 'unstaged', actionId: 'stage-all' }]);
  });

  it('commits on Ctrl+Enter in the message box, and not while it cannot', () => {
    const { fixture, host, component } = render();
    let commits = 0;
    component.commit.subscribe(() => (commits += 1));
    const box = host.querySelector<HTMLTextAreaElement>('.message');
    box?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
    expect(commits).toBe(1);

    fixture.componentRef.setInput('scm', { ...SCM, canCommit: false });
    fixture.detectChanges();
    box?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
    expect(commits).toBe(1);
    expect(host.querySelector<HTMLButtonElement>('.commit')?.disabled).toBe(true);
  });

  it('reports what is typed, and waits while something runs', () => {
    const { fixture, host, component } = render();
    const typed: string[] = [];
    component.messageChange.subscribe((text) => typed.push(text));
    const box = host.querySelector<HTMLTextAreaElement>('.message') as HTMLTextAreaElement;
    box.value = 'Fix it';
    box.dispatchEvent(new Event('input'));
    expect(typed).toEqual(['Fix it']);

    fixture.componentRef.setInput('scm', { ...SCM, busy: true, note: 'Pushing…', noteTone: 'info' });
    fixture.detectChanges();
    expect(host.getAttribute('aria-busy')).toBe('true');
    expect(box.disabled).toBe(true);
    expect(host.querySelector('.note')?.getAttribute('role')).toBe('status');
  });

  it('collapses a group to its header, and says when nothing changed', () => {
    const { host } = render({ ...SCM, groups: [{ ...SCM.groups[0]!, collapsed: true }] });
    expect(host.querySelector('.item')).toBeNull();
    expect(host.querySelector('.group-toggle')?.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('UiDocumentView diff', () => {
  it('draws each line of a diff by what it is', () => {
    const fixture = TestBed.createComponent(UiDocumentView);
    const document: UiDocumentModel = {
      path: 'src/app.ts · staged changes',
      kind: 'diff',
      lines: [
        { kind: 'hunk', text: '@@ -1 +1 @@' },
        { kind: 'remove', text: '-old' },
        { kind: 'add', text: '+new' },
        { kind: 'context', text: '' },
      ],
    };
    fixture.componentRef.setInput('document', document);
    fixture.detectChanges();
    const lines = [...(fixture.nativeElement as HTMLElement).querySelectorAll('.diff .line')];
    expect(lines.map((line) => line.className.split(' ').find((name) => name.startsWith('is-')))).toEqual(['is-hunk', 'is-remove', 'is-add', 'is-context']);
    // An empty line keeps its height.
    expect(lines[3]?.textContent).toBe(' ');
  });
});
