import { InjectionToken } from '@angular/core';

/**
 * Handed to a component opened with `UiModalService.open`, so it can close its
 * own window with a result — or with `null`, which is what `Escape` gives.
 *
 *     private readonly ref = inject<UiModalRef<string>>(UI_MODAL_REF);
 *     …
 *     this.ref.close(name);
 */
export interface UiModalRef<R> {
  close(result: R | null): void;
}

export const UI_MODAL_REF = new InjectionToken<UiModalRef<unknown>>('UiModalRef');
