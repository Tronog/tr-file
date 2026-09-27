import { HttpError } from '../../core/index.js';
import type { ConflictPolicy, OperationDecision, OperationErrorPolicy, OperationKind, OperationRequest } from './operation.model.js';

const POLICIES: readonly ConflictPolicy[] = ['fail', 'overwrite', 'skip', 'rename'];
const ERROR_POLICIES: readonly OperationErrorPolicy[] = ['fail', 'ask'];
const DECISIONS: readonly OperationDecision[] = ['skip', 'skip-all', 'retry', 'abort'];

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
      const conflict = readConflict(value);
      if (typeof value['destination'] !== 'string') {
        throw HttpError.badRequest('"destination" must be a string');
      }
      return {
        kind,
        sources: readPaths(value, 'sources'),
        destination: value['destination'],
        conflict,
        errors: readErrors(value),
      };
    }
    case 'trash':
    case 'delete':
      return { kind, paths: readPaths(value, 'paths'), errors: readErrors(value) };
    case 'restore':
      return { kind, ids: readPaths(value, 'ids', 'ids'), errors: readErrors(value) };
    case 'empty-trash':
      return { kind };
    case 'compress':
    case 'extract': {
      const conflict = readConflict(value);
      if (typeof value['destination'] !== 'string') {
        throw HttpError.badRequest('"destination" must be a string');
      }
      if (kind === 'extract') {
        if (typeof value['path'] !== 'string') {
          throw HttpError.badRequest('"path" must be a string');
        }
        return { kind, path: value['path'], destination: value['destination'], conflict };
      }
      if (typeof value['name'] !== 'string') {
        throw HttpError.badRequest('"name" must be a string');
      }
      return { kind, sources: readPaths(value, 'sources'), destination: value['destination'], name: value['name'], conflict };
    }
  }
}

function readConflict(value: Record<string, unknown>): ConflictPolicy {
  const conflict = value['conflict'] ?? 'fail';
  if (typeof conflict !== 'string' || !POLICIES.includes(conflict as ConflictPolicy)) {
    throw HttpError.badRequest(`"conflict" must be one of ${POLICIES.join(', ')}`);
  }
  return conflict as ConflictPolicy;
}

function readErrors(value: Record<string, unknown>): OperationErrorPolicy {
  const errors = value['errors'] ?? 'fail';
  if (typeof errors !== 'string' || !ERROR_POLICIES.includes(errors as OperationErrorPolicy)) {
    throw HttpError.badRequest(`"errors" must be one of ${ERROR_POLICIES.join(', ')}`);
  }
  return errors as OperationErrorPolicy;
}

/** The answer to a job that is waiting (PRD 001, Fix 3); shared by the route and the bridge. */
export function parseDecision(body: unknown): OperationDecision {
  const decision = (typeof body === 'object' && body !== null ? (body as Record<string, unknown>)['decision'] : undefined) ?? '';
  if (typeof decision !== 'string' || !DECISIONS.includes(decision as OperationDecision)) {
    throw HttpError.badRequest(`"decision" must be one of ${DECISIONS.join(', ')}`);
  }
  return decision as OperationDecision;
}

function readPaths(value: Record<string, unknown>, field: string, what = 'paths'): string[] {
  const raw = value[field];
  if (!Array.isArray(raw) || !raw.every((path): path is string => typeof path === 'string')) {
    throw HttpError.badRequest(`"${field}" must be an array of ${what}`);
  }
  return raw;
}
