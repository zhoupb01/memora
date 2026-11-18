import { closeSync, ftruncateSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { dlopen, FFIType } from "bun:ffi";

function isAlive(pid: number) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const { code } = error as NodeJS.ErrnoException;
    if (code === "ESRCH") return false;
    if (code === "EPERM") return true;
    throw error;
  }
}

export function withDreamLock(path: string, run: () => void) {
  const { symbols, close } = dlopen(process.platform === "darwin" ? "/usr/lib/libSystem.B.dylib" : "libc.so.6", {
    flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
  });
  try {
    // Keep the inode so stale takeovers and new opens contend on the same lock.
    const fd = openSync(path, "a+", 0o600);
    try {
      const locked = symbols.flock(fd, 2 | 4) === 0; // LOCK_EX | LOCK_NB
      const holder = Number(readFileSync(fd, "utf8").trim());
      if (!locked || isAlive(holder)) throw new Error(`Dream lock is held${holder ? ` by PID ${holder}` : ""}`);
      ftruncateSync(fd, 0);
      writeFileSync(fd, `${process.pid}\n`);
      try {
        run();
      } finally {
        ftruncateSync(fd, 0);
      }
    } finally {
      closeSync(fd);
    }
  } finally {
    close();
  }
}
