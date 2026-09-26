import { computed, effect, untracked } from '@angular/core';
import type { WorkbenchService } from '../workbench.service';

/**
 * Lets go of file contents nothing is showing (PRD 003, §1).
 *
 * The workbench keeps two caches of file contents: pictures, as object URLs in
 * `ImageSourceService`, and rendered previews in `FilePreviewFeature`. Tabs
 * open, close, move between groups and turn into folder tabs in a dozen places,
 * and the selection changes on every arrow key, so asking each of those to
 * release what it stopped showing is a leak waiting for the one that forgets.
 * Instead this derives *what is on screen* — every file tab in every group,
 * plus the selected entry, which the details card draws — and hands that to
 * both caches whenever it changes; each frees the rest by its own rules.
 */
export class PreviewRetentionFeature {
  /** Paths some panel has a file tab open on, active or not. */
  readonly openFiles = computed<ReadonlySet<string>>(
    () =>
      new Set(
        this.parent.editorGroupsFt
          .states()
          .flatMap((group) => group.tabs.filter((tab) => tab.kind === 'file').map((tab) => tab.path)),
      ),
  );

  /** Pictures on screen: open image tabs, and the details card's thumbnail. */
  readonly shownImages = computed<ReadonlySet<string>>(() => {
    const images = this.parent.images;
    const shown = new Set([...this.openFiles()].filter((path) => images.isImage(path)));
    const selected = this.parent.selectedEntryId();
    if (images.isImage(selected)) {
      shown.add(selected);
    }
    return shown;
  });

  constructor(private readonly parent: WorkbenchService) {
    effect(() => {
      const images = this.shownImages();
      const files = this.openFiles();
      // The caches read their own signals while they prune; none of that is
      // what this effect depends on.
      untracked(() => {
        this.parent.images.retainOnly(images);
        this.parent.filePreviewFt.retainOnly(files);
      });
    });
  }
}
