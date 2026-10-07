/**
 * The PowerShell that measures a Windows machine's processes (PRD 014, §1),
 * kept running beside the backend: it compiles the C# below once, prints
 * `ready`, then answers each line it is sent with one line of JSON — every
 * process, as `WindowsProcessSource` reads it.
 *
 * One `NtQuerySystemInformation(SystemProcessInformation)` call describes
 * every process at once — CPU times, *private working set* (Task Manager's
 * Memory), bytes read and written, threads and their states (all of them
 * suspended is Task Manager's *Suspended*) — without opening any of them. Only
 * what that call does not give is asked of each process, once in its life:
 * its executable, command line and owner. The windows on the desktop say
 * which are *Apps* (a visible, unowned, uncloaked top-level window with a
 * title, as Task Manager counts them) and which have stopped responding.
 *
 * Every string goes out with anything past ASCII escaped, so the pipe's code
 * page never matters.
 */
export const WINDOWS_SAMPLER_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;

public static class TrFileProcesses {
  [DllImport("ntdll.dll")] static extern int NtQuerySystemInformation(int cls, IntPtr info, int length, out int needed);
  [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr process, int cls, IntPtr info, int length, out int needed);
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool QueryFullProcessImageNameW(IntPtr process, uint flags, StringBuilder name, ref uint size);
  [DllImport("advapi32.dll")] static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
  [DllImport("advapi32.dll")] static extern bool GetTokenInformation(IntPtr token, int cls, IntPtr info, int length, out int needed);
  delegate bool WindowVisitor(IntPtr window, IntPtr data);
  [DllImport("user32.dll")] static extern bool EnumWindows(WindowVisitor visitor, IntPtr data);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr window, uint command);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowTextW(IntPtr window, StringBuilder text, int max);
  [DllImport("user32.dll")] static extern bool IsHungAppWindow(IntPtr window);
  [DllImport("user32.dll")] static extern int GetWindowLongW(IntPtr window, int index);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr window, int attribute, out int value, int size);

  const int SystemProcessInformation = 5;
  const int ProcessCommandLineInformation = 60;
  const uint STATUS_INFO_LENGTH_MISMATCH = 0xC0000004;
  const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
  const uint TOKEN_QUERY = 0x0008;
  const int TokenUser = 1;
  const int GWL_EXSTYLE = -20;
  const int WS_EX_TOOLWINDOW = 0x80;
  const int DWMWA_CLOAKED = 14;

  class Fixed { public string Path; public string Command; public string User; }
  class Window { public string Title; public bool Hung; }

  static readonly Dictionary<string, Fixed> fixedByKey = new Dictionary<string, Fixed>();
  static readonly Dictionary<string, string> userBySid = new Dictionary<string, string>();
  static int bufferSize = 1 << 20;

  public static string Sample() {
    if (IntPtr.Size != 8) { throw new Exception("A 64-bit PowerShell is needed to read the processes."); }
    Dictionary<uint, Window> windows = Windows();
    string windir = (Environment.GetEnvironmentVariable("windir") ?? @"C:\Windows").TrimEnd('\\') + @"\";
    IntPtr buffer = IntPtr.Zero;
    try {
      int needed;
      for (;;) {
        buffer = Marshal.AllocHGlobal(bufferSize);
        uint status = (uint)NtQuerySystemInformation(SystemProcessInformation, buffer, bufferSize, out needed);
        if (status == 0) { break; }
        Marshal.FreeHGlobal(buffer);
        buffer = IntPtr.Zero;
        if (status != STATUS_INFO_LENGTH_MISMATCH) { throw new Exception("NtQuerySystemInformation failed: 0x" + status.ToString("X8")); }
        bufferSize = Math.Max(bufferSize * 2, needed + 65536);
      }
      StringBuilder json = new StringBuilder(256 * 1024);
      json.Append('[');
      HashSet<string> seen = new HashSet<string>();
      bool first = true;
      int offset = 0;
      for (;;) {
        IntPtr entry = IntPtr.Add(buffer, offset);
        int next = Marshal.ReadInt32(entry, 0x00);
        int threads = Marshal.ReadInt32(entry, 0x04);
        long privateWorkingSet = Marshal.ReadInt64(entry, 0x08);
        long createTime = Marshal.ReadInt64(entry, 0x20);
        long userTime = Marshal.ReadInt64(entry, 0x28);
        long kernelTime = Marshal.ReadInt64(entry, 0x30);
        int nameBytes = Marshal.ReadInt16(entry, 0x38) & 0xFFFF;
        IntPtr namePointer = Marshal.ReadIntPtr(entry, 0x40);
        uint pid = (uint)Marshal.ReadInt64(entry, 0x50);
        uint ppid = (uint)Marshal.ReadInt64(entry, 0x58);
        uint session = (uint)Marshal.ReadInt32(entry, 0x64);
        long readBytes = Marshal.ReadInt64(entry, 0xE8);
        long writeBytes = Marshal.ReadInt64(entry, 0xF0);

        if (pid != 0) {
          bool suspended = threads > 0;
          for (int thread = 0; thread < threads && suspended; thread++) {
            IntPtr info = IntPtr.Add(entry, 0x100 + thread * 0x50);
            // ThreadState 5 is Waiting; WaitReason 5 is Suspended.
            suspended = Marshal.ReadInt32(info, 0x44) == 5 && Marshal.ReadInt32(info, 0x48) == 5;
          }
          string name = nameBytes == 0 || namePointer == IntPtr.Zero
            ? (pid == 4 ? "System" : "Unknown")
            : Marshal.PtrToStringUni(namePointer, nameBytes / 2);
          string key = pid + ":" + createTime;
          seen.Add(key);
          Fixed known;
          if (!fixedByKey.TryGetValue(key, out known)) {
            known = ReadFixed(pid);
            fixedByKey[key] = known;
          }
          Window window;
          windows.TryGetValue(pid, out window);
          string category = window != null ? "app"
            : pid <= 4 || (known.Path != null && known.Path.StartsWith(windir, StringComparison.OrdinalIgnoreCase)) || (known.Path == null && session == 0) ? "system"
            : "background";
          string status = window != null && window.Hung ? "not-responding" : suspended ? "suspended" : "running";

          if (!first) { json.Append(','); }
          first = false;
          json.Append('[').Append(pid).Append(',').Append(ppid).Append(',');
          Str(json, name); json.Append(',');
          Str(json, known.Path); json.Append(',');
          Str(json, known.Command); json.Append(',');
          Str(json, known.User); json.Append(',');
          Str(json, window == null ? null : window.Title); json.Append(',');
          Str(json, status); json.Append(',');
          Str(json, category); json.Append(',');
          json.Append((userTime + kernelTime) / 10000).Append(',');
          json.Append(privateWorkingSet).Append(',');
          json.Append(readBytes + writeBytes).Append(',');
          json.Append(threads).Append(',');
          json.Append(createTime == 0 ? 0 : createTime / 10000 - 11644473600000L);
          json.Append(']');
        }
        if (next == 0) { break; }
        offset += next;
      }
      json.Append(']');
      List<string> gone = new List<string>();
      foreach (string key in fixedByKey.Keys) { if (!seen.Contains(key)) { gone.Add(key); } }
      foreach (string key in gone) { fixedByKey.Remove(key); }
      return json.ToString();
    } finally {
      if (buffer != IntPtr.Zero) { Marshal.FreeHGlobal(buffer); }
    }
  }

  /** The windows Task Manager would call an app's: the first title of each process, and whether any has hung. */
  static Dictionary<uint, Window> Windows() {
    Dictionary<uint, Window> found = new Dictionary<uint, Window>();
    EnumWindows(delegate (IntPtr handle, IntPtr data) {
      if (!IsWindowVisible(handle) || GetWindow(handle, 4) != IntPtr.Zero) { return true; }
      if ((GetWindowLongW(handle, GWL_EXSTYLE) & WS_EX_TOOLWINDOW) != 0) { return true; }
      int cloaked;
      if (DwmGetWindowAttribute(handle, DWMWA_CLOAKED, out cloaked, 4) == 0 && cloaked != 0) { return true; }
      StringBuilder text = new StringBuilder(256);
      if (GetWindowTextW(handle, text, text.Capacity) == 0) { return true; }
      uint pid;
      GetWindowThreadProcessId(handle, out pid);
      Window window;
      if (!found.TryGetValue(pid, out window)) {
        window = new Window();
        window.Title = text.ToString();
        found[pid] = window;
      }
      window.Hung = window.Hung || IsHungAppWindow(handle);
      return true;
    }, IntPtr.Zero);
    return found;
  }

  static Fixed ReadFixed(uint pid) {
    Fixed known = new Fixed();
    IntPtr process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
    if (process == IntPtr.Zero) { return known; }
    try {
      StringBuilder path = new StringBuilder(1024);
      uint size = (uint)path.Capacity;
      if (QueryFullProcessImageNameW(process, 0, path, ref size)) { known.Path = path.ToString(0, (int)size); }
      known.Command = CommandLine(process);
      known.User = Owner(process);
    } catch {
      // What could not be read stays unknown.
    } finally {
      CloseHandle(process);
    }
    return known;
  }

  static string CommandLine(IntPtr process) {
    int needed;
    NtQueryInformationProcess(process, ProcessCommandLineInformation, IntPtr.Zero, 0, out needed);
    if (needed <= 0 || needed > 1 << 20) { return null; }
    IntPtr info = Marshal.AllocHGlobal(needed);
    try {
      if (NtQueryInformationProcess(process, ProcessCommandLineInformation, info, needed, out needed) != 0) { return null; }
      int length = Marshal.ReadInt16(info, 0) & 0xFFFF;
      IntPtr text = Marshal.ReadIntPtr(info, 8);
      return length == 0 || text == IntPtr.Zero ? null : Marshal.PtrToStringUni(text, length / 2);
    } finally {
      Marshal.FreeHGlobal(info);
    }
  }

  static string Owner(IntPtr process) {
    IntPtr token;
    if (!OpenProcessToken(process, TOKEN_QUERY, out token)) { return null; }
    try {
      int needed;
      GetTokenInformation(token, TokenUser, IntPtr.Zero, 0, out needed);
      if (needed <= 0) { return null; }
      IntPtr info = Marshal.AllocHGlobal(needed);
      try {
        if (!GetTokenInformation(token, TokenUser, info, needed, out needed)) { return null; }
        SecurityIdentifier sid = new SecurityIdentifier(Marshal.ReadIntPtr(info, 0));
        string id = sid.Value;
        string name;
        if (!userBySid.TryGetValue(id, out name)) {
          try { name = sid.Translate(typeof(NTAccount)).Value; } catch { name = id; }
          userBySid[id] = name;
        }
        return name;
      } finally {
        Marshal.FreeHGlobal(info);
      }
    } finally {
      CloseHandle(token);
    }
  }

  static void Str(StringBuilder json, string value) {
    if (value == null) { json.Append("null"); return; }
    json.Append('"');
    foreach (char c in value) {
      if (c == '"') { json.Append("\\\""); }
      else if (c == '\\') { json.Append("\\\\"); }
      else if (c < 0x20 || c > 0x7E) { json.Append("\\u").Append(((int)c).ToString("x4")); }
      else { json.Append(c); }
    }
    json.Append('"');
  }
}
'@
[Console]::Out.WriteLine('ready')
[Console]::Out.Flush()
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  try {
    [Console]::Out.WriteLine([TrFileProcesses]::Sample())
  } catch {
    [Console]::Out.WriteLine('{"error":' + (ConvertTo-Json -Compress ([string]$_.Exception.Message)) + '}')
  }
  [Console]::Out.Flush()
}
`;
