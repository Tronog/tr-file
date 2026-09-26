import { InjectionToken } from '@angular/core';

/**
 * Handed to a component opened with `ModalService.open`, so it can close its
 * own window with a result — or with `null`, which is what `Escape` gives.
 *
 *     private readonly ref = inject<ModalRef<string>>(MODAL_REF);
 *     …
 *     this.ref.close(name);
 */
export interface ModalRef<R> {
  close(result: R | null): void;
}

export const MODAL_REF = new InjectionToken<ModalRef<unknown>>('ModalRef');
