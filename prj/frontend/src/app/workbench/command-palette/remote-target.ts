/**
 * A remote server to connect to (PRD 009, §1; the connection itself is PRD 006).
 *
 * Typed as `[user:password@]host:port`, where the host is an IPv4 address, a
 * host name, or an IPv6 address in brackets: `10.0.0.5:22`,
 * `ana:secret@files.example.com:2222`, `[::1]:8022`.
 */
export interface RemoteTarget {
  readonly user: string | null;
  readonly password: string | null;
  readonly host: string;
  readonly port: number;
}

const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const IPV6 = /^\[[0-9a-f:.]+\]$/i;

/** The target, or a sentence saying what is wrong with the text. */
export function parseRemoteTarget(raw: string): RemoteTarget | string {
  const text = raw.trim();
  if (text === '') {
    return 'Enter a server as [user:password@]host:port';
  }

  // The last `@` ends the credentials, so a password may contain one.
  const at = text.lastIndexOf('@');
  let user: string | null = null;
  let password: string | null = null;
  if (at !== -1) {
    const credentials = text.slice(0, at);
    const colon = credentials.indexOf(':');
    if (colon <= 0 || colon === credentials.length - 1) {
      return 'Credentials go before the @ as user:password';
    }
    user = credentials.slice(0, colon);
    password = credentials.slice(colon + 1);
  }

  const address = text.slice(at + 1);
  const colon = address.lastIndexOf(':');
  if (colon === -1 || (address.startsWith('[') && colon < address.indexOf(']'))) {
    return 'Add the port after the host, e.g. files.example.com:22';
  }
  const host = address.slice(0, colon);
  const portText = address.slice(colon + 1);

  const port = /^\d+$/.test(portText) ? Number(portText) : NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return `'${portText}' is not a port; use a number from 1 to 65535`;
  }
  if (!isHost(host)) {
    return host === '' ? 'Add a host before the port' : `'${host}' is not a host name or an IP address`;
  }
  return { user, password, host, port };
}

/** `user@host:port`, never with the password. */
export function describeRemoteTarget(target: RemoteTarget): string {
  return `${target.user === null ? '' : `${target.user}@`}${target.host}:${target.port}`;
}

function isHost(host: string): boolean {
  if (IPV6.test(host)) {
    return true;
  }
  if (IPV4.test(host)) {
    return host.split('.').every((octet) => Number(octet) <= 255);
  }
  // Something that is all digits and dots but not four octets is not a name either.
  if (/^[\d.]+$/.test(host)) {
    return false;
  }
  return host.length <= 253 && host.split('.').every((label) => HOST_LABEL.test(label));
}
