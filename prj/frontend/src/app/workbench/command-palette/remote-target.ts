/**
 * A remote server to connect to (PRD 009, §1; the connection itself is PRD 006).
 *
 * Typed as `[user:password@]host:port`, where the host is an IPv4 address, a
 * host name, or an IPv6 address in brackets: `10.0.0.5:22`,
 * `ana:secret@files.example.com:2222`, `[::1]:8022`. The password may be left
 * out — `ana@files.example.com:2222` — which is how a saved server, whose
 * password is never kept, is written back. A leading `https://` (or
 * `http://`) says how to reach it; without one, port 443 means HTTPS.
 */
export interface RemoteTarget {
  /** `https` when asked for, or on port 443; `http` otherwise. */
  readonly scheme: 'http' | 'https';
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
  let text = raw.trim();
  if (text === '') {
    return 'Enter a server as [user:password@]host:port';
  }
  const schemeMatch = /^(https?):\/\//i.exec(text);
  const explicit = schemeMatch ? (schemeMatch[1]?.toLowerCase() as 'http' | 'https') : null;
  if (schemeMatch) {
    text = text.slice(schemeMatch[0].length);
  } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    return 'Only http:// and https:// servers can be connected to';
  }

  // The last `@` ends the credentials, so a password may contain one.
  const at = text.lastIndexOf('@');
  let user: string | null = null;
  let password: string | null = null;
  if (at !== -1) {
    const credentials = text.slice(0, at);
    const colon = credentials.indexOf(':');
    const name = colon === -1 ? credentials : credentials.slice(0, colon);
    if (name === '' || (colon !== -1 && colon === credentials.length - 1)) {
      return 'Credentials go before the @ as user:password, or just user';
    }
    user = name;
    password = colon === -1 ? null : credentials.slice(colon + 1);
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
  return { scheme: explicit ?? (port === 443 ? 'https' : 'http'), user, password, host, port };
}

/**
 * `user@host:port`, never with the password — with `https://` in front when
 * HTTPS was asked for on a port that would not have implied it.
 */
export function describeRemoteTarget(target: Pick<RemoteTarget, 'user' | 'host' | 'port'> & { scheme?: 'http' | 'https' }): string {
  const scheme = target.scheme === 'https' && target.port !== 443 ? 'https://' : target.scheme === 'http' && target.port === 443 ? 'http://' : '';
  return `${scheme}${target.user === null ? '' : `${target.user}@`}${target.host}:${target.port}`;
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
