import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { localFileName, looksLikeProgram, openTempRoot } from './desktop-shell.js';

/** PRD 003, §5 — what counts as a program, decided in the main process. */

describe('looksLikeProgram', () => {
  it('knows Windows programs and scripts on every platform', () => {
    for (const platform of ['win32', 'linux', 'darwin'] as const) {
      for (const name of ['setup.EXE', 'run.bat', 'x.cmd', 'a.ps1', 'b.vbs', 'c.js', 'd.lnk', 'e.jar', 'f.reg', 'g.msi']) {
        assert.equal(looksLikeProgram(name, false, platform), true, `${name} on ${platform}`);
      }
    }
  });

  it('knows POSIX launchers, and any file with an execute bit, off Windows', () => {
    for (const name of ['app.desktop', 'install.sh', 'tool.AppImage', 'go.command', 'Thing.app', 'x.run']) {
      assert.equal(looksLikeProgram(name, false, 'linux'), true, name);
      assert.equal(looksLikeProgram(name, false, 'win32'), false, `${name} on Windows`);
    }
    assert.equal(looksLikeProgram('tool', true, 'linux'), true);
    assert.equal(looksLikeProgram('tool', true, 'win32'), false);
  });

  it('leaves documents alone', () => {
    for (const name of ['notes.md', 'photo.jpg', 'report.pdf', 'Makefile', '.bashrc']) {
      assert.equal(looksLikeProgram(name, false, 'linux'), false, name);
    }
  });
});

describe('localFileName', () => {
  it('keeps only a safe last segment of a remote path', () => {
    assert.equal(localFileName('docs/report.pdf'), 'report.pdf');
    assert.equal(localFileName('a/..'), 'file');
    assert.equal(localFileName(''), 'file');
    assert.equal(localFileName('x/we:ird?*.txt'), 'we_ird__.txt');
    assert.equal(localFileName('x/back\\slash'), 'back_slash');
  });

  it('puts copies in a folder of their own under the temp dir', () => {
    assert.equal(openTempRoot('/tmp'), join('/tmp', 'tr-file-open'));
  });
});
