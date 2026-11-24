import { closeSync, fstatSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";

export function isProcessAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    if (error?.code === "EPERM") return true;
    throw error;
  }
}

export function withDreamLock(path, run) {
  let fd;
  try {
    fd = openSync(path, "wx", 0o600);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    let raw = "";
    try {
      raw = readFileSync(path, "utf8").trim();
    } catch (readErr) {
      if (readErr?.code !== "ENOENT") throw readErr;
    }
    const holder = Number(raw);
    if (isProcessAlive(holder)) {
      throw new Error(`Dream lock is held by PID ${holder}`);
    }
    rmSync(path, { force: true });
    try {
      fd = openSync(path, "wx", 0o600);
    } catch (retryError) {
      if (retryError?.code === "EEXIST") throw new Error("Dream lock is held");
      throw retryError;
    }
  }

  const { dev, ino } = fstatSync(fd);
  try {
    writeFileSync(fd, `${process.pid}\n`);
    closeSync(fd);
    fd = undefined;
    return run();
  } finally {
    if (fd !== undefined) closeSync(fd);
    const cur = statSync(path, { throwIfNoEntry: false });
    if (cur && cur.dev === dev && cur.ino === ino) {
      rmSync(path, { force: true });
    }
  }
}
