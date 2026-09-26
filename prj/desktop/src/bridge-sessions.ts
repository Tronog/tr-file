import type { WebContents } from 'electron';

import { FileSystemBridge, type FsBridgeSession } from '@tr-file/backend/bridge';

/**
 * Who is signed in, per window (PRD 003, §2).
 *
 * The bridge decides whether a command may run; this only remembers, for each
 * window, the session the bridge updates on `login` and `logout`. Both
 * channels that reach the file system — commands and saves — read the same
 * session, so signing in once is signing in for both, and a window that closes
 * takes its session with it.
 */
export class BridgeSessions {
  private readonly sessions = new Map<number, FsBridgeSession>();

  /** The session of the window `sender` belongs to; a new window starts signed out. */
  for(sender: WebContents): FsBridgeSession {
    let session = this.sessions.get(sender.id);
    if (session === undefined) {
      session = FileSystemBridge.openSession();
      this.sessions.set(sender.id, session);
      const id = sender.id;
      sender.once('destroyed', () => this.sessions.delete(id));
    }
    return session;
  }
}
