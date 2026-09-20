import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';

import { HttpError, type Logger } from '../../core/index.js';
import type { FilesService } from '../files/index.js';
import type {
  FsBridgeFailure,
  FsBridgeRequest,
  FsBridgeResponse,
  FsReadRequest,
  FsReadResult,
  FsUploadRequest,
} from './bridge.model.js';

/**
 * The file-system API without HTTP (PRD 001, §8.1).
 *
 * `FilesRoutes` turns HTTP requests into `FilesService` calls; this turns
 * plain command objects into the same calls. Both are thin, and both sit on
 * the *same* `FilesService` instance — same path resolver, same root
 * confinement, same upload ceiling — which is the point: the desktop does not
 * get a second, laxer way into the file system, it gets a second way to ask.
 *
 * Two rules follow from the channel this is reached through:
 *
 * 1. **Requests are untrusted.** They arrive from a renderer over IPC, so
 *    every field is validated here rather than assumed from the type.
 * 2. **Failures are returned, not thrown.** An `Error` crossing a structured
 *    clone boundary loses its type, its code and usually its message, so a
 *    failure is flattened into the same `{ error: { code, message } }` shape
 *    HTTP would have sent — plus the status that shape would have had.
 */
export class FileSystemBridge {
  constructor(
    private readonly files: FilesService,
    private readonly logger: Logger,
  ) {}

  /** Runs one command. Never throws; a failure is part of the answer. */
  async dispatch(request: unknown): Promise<FsBridgeResponse> {
    const startedAt = performance.now();
    try {
      const parsed = FileSystemBridge.parse(request);
      const data = await this.run(parsed);
      // The HTTP side logs every request through `RequestLoggerMiddleware`;
      // the bridge would otherwise be a silent second door into the same API.
      this.logger.debug('command', {
        command: parsed.command,
        path: parsed.path,
        durationMs: Number((performance.now() - startedAt).toFixed(3)),
      });
      return { data };
    } catch (error: unknown) {
      return this.toFailure(error);
    }
  }

  private async run(request: FsBridgeRequest): Promise<unknown> {
    switch (request.command) {
      case 'list':
        return (await this.files.listDirectory(request.path)).toJSON();
      case 'details':
        return (await this.files.getDetails(request.path)).toJSON();
      case 'read':
        return this.read(request);
      case 'upload':
        return this.upload(request);
    }
  }

  /**
   * Reads a whole file into memory, refusing anything past `maxBytes` *before*
   * the read rather than after it — the caller knows the size from the listing
   * and says what it is willing to hold.
   */
  private async read(request: FsReadRequest): Promise<FsReadResult> {
    const target = await this.files.resolveDownload(request.path);
    const limit = request.maxBytes;

    if (limit !== undefined && target.size > limit) {
      throw HttpError.payloadTooLarge(
        `File is larger than the ${limit} byte limit`,
        { size: target.size },
      );
    }

    const content = await readFile(target.absolutePath);
    return {
      path: request.path,
      name: target.name,
      size: target.size,
      mimeType: target.mimeType,
      // A plain view over the buffer: `Buffer` is a `Uint8Array`, but only the
      // latter survives a structured clone as itself.
      content: new Uint8Array(content),
    };
  }

  /**
   * Stores one file. The bytes arrive whole — there is no multipart stream to
   * parse on this side — so they are handed to the service as a one-shot
   * stream, which keeps `saveUpload`'s write-to-temp-then-rename intact.
   */
  private async upload(request: FsUploadRequest): Promise<unknown> {
    const details = await this.files.saveUpload({
      directoryPath: request.path,
      filename: request.filename,
      content: Readable.from(Buffer.from(request.content)),
      overwrite: request.overwrite,
    });
    return details.toJSON();
  }

  private toFailure(error: unknown): FsBridgeFailure {
    if (error instanceof HttpError) {
      return {
        error: {
          code: error.code,
          message: error.message,
          status: error.status,
          ...(error.details === undefined ? {} : { details: error.details }),
        },
      };
    }

    this.logger.error('bridge command failed', {
      error: error instanceof Error ? error.message : String(error),
      ...(error instanceof Error && error.stack !== undefined ? { stack: error.stack } : {}),
    });

    return {
      error: { code: 'INTERNAL_ERROR', message: 'Internal Server Error', status: 500 },
    };
  }

  /**
   * Narrows an untrusted value to a request, rejecting with the same
   * `BAD_REQUEST` an HTTP caller would have received for a malformed query.
   */
  private static parse(value: unknown): FsBridgeRequest {
    if (typeof value !== 'object' || value === null) {
      throw HttpError.badRequest('A bridge request must be an object');
    }

    const { command } = value as { command?: unknown };
    const path = FileSystemBridge.readString(value, 'path');

    switch (command) {
      case 'list':
        return { command, path };
      case 'details':
        return { command, path };
      case 'read': {
        const maxBytes = FileSystemBridge.readOptionalCount(value, 'maxBytes');
        return { command, path, ...(maxBytes === undefined ? {} : { maxBytes }) };
      }
      case 'upload':
        return {
          command,
          path,
          filename: FileSystemBridge.readString(value, 'filename'),
          content: FileSystemBridge.readContent(value),
          overwrite: (value as { overwrite?: unknown }).overwrite === true,
        };
      default:
        throw HttpError.badRequest(`Unknown bridge command: ${String(command)}`);
    }
  }

  private static readString(value: object, field: string): string {
    const raw = (value as Record<string, unknown>)[field];
    if (typeof raw !== 'string') {
      throw HttpError.badRequest(`Bridge request field "${field}" must be a string`);
    }
    return raw;
  }

  private static readOptionalCount(value: object, field: string): number | undefined {
    const raw = (value as Record<string, unknown>)[field];
    if (raw === undefined) {
      return undefined;
    }
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0) {
      throw HttpError.badRequest(`Bridge request field "${field}" must be a non-negative integer`);
    }
    return raw;
  }

  private static readContent(value: object): Uint8Array {
    const raw = (value as { content?: unknown }).content;
    if (raw instanceof Uint8Array) {
      return raw;
    }
    if (raw instanceof ArrayBuffer) {
      return new Uint8Array(raw);
    }
    throw HttpError.badRequest('Bridge request field "content" must be binary data');
  }
}
