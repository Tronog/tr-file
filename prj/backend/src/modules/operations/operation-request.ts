import { HttpError } from '../../core/index.js';
import type { ConflictPolicy, OperationKind, OperationRequest } from './operation.model.js';

const POLICIES: readonly ConflictPolicy[] = ['fail', 'overwrite', 'skip', 'rename'];

/**
 * Narrows an untrusted body to an operation request. Shared by the HTTP
 * routes and the bridge, so both refuse exactly the same things in the same
 * words.
 */
export function parseOperationRequest(kind: OperationKind, body: unknown): OperationRequest {
  const value = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  switch (kind) {
    case 'copy':
    case 'move': {
      const conflict = value['conflict'] ?? 'fail';
      if (typeof conflict !== 'string' || !POLICIES.includes(conflict as ConflictPolicy)) {
        throw HttpError.badRequest(`"conflict" must be one of ${POLICIES.join(', ')}`);
      }
      if (typeof value['destination'] !== 'string') {
        throw HttpError.badRequest('"destination" must be a string');
      }
      return {
        kind,
        sources: readPaths(value, 'sources'),
        destination: value['destination'],
        conflict: conflict as ConflictPolicy,
      };
    }
    case 'trash':
      return { kind, paths: readPaths(value, 'paths') };
    case 'empty-trash':
      return { kind };
  }
}

function readPaths(value: Record<string, unknown>, field: string): string[] {
  const raw = value[field];
  if (!Array.isArray(raw) || !raw.every((path): path is string => typeof path === 'string')) {
    throw HttpError.badRequest(`"${field}" must be an array of paths`);
  }
  return raw;
}
