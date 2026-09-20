import { HttpErrorResponse } from '@angular/common/http';
import { FsError } from './fs-error';

describe('FsError', () => {
  it('prefers the contract error envelope', () => {
    const error = FsError.fromHttp(
      new HttpErrorResponse({
        status: 413,
        statusText: 'Payload Too Large',
        error: { error: { code: 'PAYLOAD_TOO_LARGE', message: 'Too big', details: { max: 10 } } },
      }),
    );

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('FsError');
    expect(error.status).toBe(413);
    expect(error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(error.message).toBe('Too big');
    expect(error.details).toEqual({ max: 10 });
  });

  it('omits details when the server sends none', () => {
    const error = FsError.fromHttp(
      new HttpErrorResponse({ status: 404, error: { error: { code: 'NOT_FOUND', message: 'Gone' } } }),
    );

    expect(error.details).toBeUndefined();
  });

  it('describes a status-0 failure as unreachable rather than empty', () => {
    const error = FsError.fromHttp(new HttpErrorResponse({ status: 0, error: new ProgressEvent('error') }));

    expect(error.status).toBe(0);
    expect(error.code).toBe('NETWORK_ERROR');
    expect(error.message).toContain('Could not reach the server');
  });

  it('falls back to the status when the body is not the contract envelope', () => {
    const error = FsError.fromHttp(
      new HttpErrorResponse({ status: 502, statusText: 'Bad Gateway', error: '<html>nginx</html>' }),
    );

    expect(error.code).toBe('UNKNOWN_ERROR');
    expect(error.message).toBe('Bad Gateway (HTTP 502)');
  });

  it('from() passes an FsError through and wraps anything else', () => {
    const original = new FsError('boom', 409, 'CONFLICT');
    expect(FsError.from(original)).toBe(original);

    const wrapped = FsError.from(new TypeError('nope'));
    expect(wrapped).toBeInstanceOf(FsError);
    expect(wrapped.message).toBe('nope');
    expect(wrapped.code).toBe('UNKNOWN_ERROR');
  });
});
