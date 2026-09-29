import { computed } from '@angular/core';
import type { UiTitleBarUpgrade } from '@tr-file/ui';
import type { WorkbenchService } from '../workbench.service';

/**
 * The blue *Upgrade* button right of the command palette box (PRD 001, §8.6).
 *
 * The desktop shell watches the share the distributables are published on and
 * says when a newer one is there (`DesktopUpdateService`); this feature turns
 * that into the button, and a press into an upgrade — asked first, since the
 * window closes and the new version starts in its place, taking any job still
 * running with it. In a browser there is never a button. *File › Check for
 * Updates…* (§8.6.1) asks the shell to look now.
 */
export class AppUpdateFeature {
  constructor(private readonly parent: WorkbenchService) {}

  /** Starts following the shell; called once, by the `Workbench` component. */
  start(): void {
    this.parent.desktopUpdate.start();
  }

  /** The button, or `null` while up to date. */
  readonly upgrade = computed<UiTitleBarUpgrade | null>(() => {
    const { available, upgrading } = this.parent.desktopUpdate.status();
    if (available === null) {
      return null;
    }
    return upgrading
      ? { label: 'Upgrading…', title: `Installing ${available}`, busy: true }
      : { label: 'Upgrade', title: `A new version is available: ${available}`, busy: false };
  });

  /** Whether *Check for Updates…* can be asked: only of the desktop shell. */
  readonly canCheck = computed(() => this.parent.desktopUpdate.isAvailable);

  /** The button was pressed: ask, then upgrade and restart. */
  async run(): Promise<void> {
    const { available, upgrading } = this.parent.desktopUpdate.status();
    if (available === null || upgrading) {
      return;
    }
    await this.confirmAndUpgrade(available, 'Upgrade tr-file now?');
  }

  /**
   * *File › Check for Updates…* (PRD 001, §8.6.1): the share is looked at now
   * rather than at the next quarter hour, and the answer is always said — up
   * to date, a newer version (upgraded from right there, if wanted), or why
   * it could not be looked at.
   */
  async check(): Promise<void> {
    const update = this.parent.desktopUpdate;
    if (!update.isAvailable) {
      return;
    }
    const error = await update.check();
    if (!update.supported()) {
      await this.parent.modal.message({
        message: 'This copy of tr-file does not update itself.',
        detail: 'Only a packaged AppImage, portable .exe or installed copy is upgraded from the update folder.',
        severity: 'info',
      });
      return;
    }
    if (error !== null) {
      await this.parent.modal.message({ message: 'Could not check for updates.', detail: error, severity: 'warning' });
      return;
    }
    const { available, upgrading } = update.status();
    if (upgrading) {
      return;
    }
    if (available === null) {
      await this.parent.modal.message({ message: 'tr-file is up to date.', severity: 'info' });
      return;
    }
    await this.confirmAndUpgrade(available, 'A new version of tr-file is available.');
  }

  /** Asks — saying what is still running — then upgrades, and says why not if it could not. */
  private async confirmAndUpgrade(available: string, message: string): Promise<void> {
    const running = this.parent.operationsFt.runningCount() + this.parent.transfersFt.activeCount();
    const confirmed = await this.parent.modal.confirm({
      message,
      detail:
        `Upgrading closes the window and starts the new version (${available}) in its place.` +
        (running > 0 ? ` ${running === 1 ? 'One job is' : `${running} jobs are`} still running and will be stopped.` : ''),
      confirmLabel: 'Upgrade',
      cancelLabel: 'Later',
      ...(running > 0 ? { severity: 'warning' as const } : {}),
    });
    if (!confirmed) {
      return;
    }
    const error = await this.parent.desktopUpdate.upgrade();
    if (error !== null) {
      await this.parent.modal.message({ message: 'tr-file could not be upgraded.', detail: error, severity: 'error' });
    }
  }
}
