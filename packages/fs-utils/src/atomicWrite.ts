import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Atomic UTF-8 file write: temp file, rotate previous to `.bak`, rename into place.
 * Adapted from legacy `vibrainStore.ts` (`atomicWrite`) with a Windows-safe finalize
 * (rename-with-replace semantics differ on Win32 vs POSIX).
 */
export async function atomicWriteUtf8(filePath: string, data: string): Promise<void> {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tmp = path.join(dir, `.${base}.${process.pid}.tmp`);
  const bak = path.join(dir, `.${base}.bak`);
  await mkdir(dir, { recursive: true });
  await writeFile(tmp, data, "utf8");
  try {
    await rename(filePath, bak);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code;
    if (code !== "ENOENT") throw e;
  }
  try {
    await rename(tmp, filePath);
  } catch (e) {
    try {
      await rename(bak, filePath);
    } catch {
      // best-effort restore
    }
    throw e;
  }
  await unlink(bak).catch(() => {});
}
