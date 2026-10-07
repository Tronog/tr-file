import { Component, computed, input } from '@angular/core';
import { UiIcon } from '@tr-file/ui';
import type { UiPermissions, UiPermissionTriplet } from '../models';

/** One rendered cell of the matrix. */
interface PermissionCell {
  readonly permission: string;
  readonly on: boolean;
  /** Full sentence for screen readers, e.g. "Owner: write allowed". */
  readonly description: string;
}

/** One principal row of the matrix. */
interface PermissionRow {
  readonly principal: string;
  readonly cells: readonly PermissionCell[];
}

/**
 * The POSIX permission matrix of the details side bar.
 *
 * Display only: the check boxes are spans, never inputs, so nothing here is
 * focusable. A real `<table>` carries the semantics and every cell names both
 * its principal and its permission, because the tick alone tells a screen
 * reader nothing. The octal mode sits in the header row's corner cell.
 */
@Component({
  selector: 'ui-permission-grid',
  templateUrl: './ui-permission-grid.html',
  styleUrl: './ui-permission-grid.scss',
  imports: [UiIcon],
  host: { class: 'ui-permission-grid' },
})
export class UiPermissionGrid {
  readonly permissions = input.required<UiPermissions>();

  protected readonly rows = computed<readonly PermissionRow[]>(() => {
    const permissions = this.permissions();
    return [
      this.toRow('Owner', permissions.owner),
      this.toRow('Group', permissions.group),
      this.toRow('Others', permissions.others),
    ];
  });

  private toRow(principal: string, triplet: UiPermissionTriplet): PermissionRow {
    const cells: readonly (readonly [string, boolean])[] = [
      ['read', triplet.read],
      ['write', triplet.write],
      ['execute', triplet.execute],
    ];

    return {
      principal,
      cells: cells.map(([permission, on]) => ({
        permission,
        on,
        description: `${principal}: ${permission} ${on ? 'allowed' : 'denied'}`,
      })),
    };
  }
}
