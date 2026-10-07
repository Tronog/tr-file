/**
 * Hands text the app made — an export (PRD 013, §2.2) — to the user as a file
 * called `name`: a browser saves it as any download; on the desktop Electron
 * asks where, with the system's save dialog. Nothing goes to the backend.
 */
export function saveText(name: string, text: string, type = 'text/plain;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.style.display = 'none';
  document.body.append(link);
  link.click();
  link.remove();
  // Revoked once the download has had the URL; a click starts it synchronously.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
