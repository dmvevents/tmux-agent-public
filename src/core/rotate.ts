/**
 * Capture-log rotation. pipe-pane appends forever; a chatty agent lane WILL fill the disk
 * (our production predecessor reached a 345MB single log and a 38GB sqlite before anyone
 * noticed). Rotation is size-triggered, keeps N generations, and gzip is deliberately NOT
 * used — a rotated log must stay greppable with zero tooling.
 *
 * Called opportunistically (spawn, capture-start, monitor sweep). Never throws into the
 * caller's path: an observability layer must not break the thing it observes.
 */
import { renameSync, statSync, existsSync, unlinkSync } from "node:fs";

export interface RotateOpts {
  maxBytes?: number; // rotate when the live log exceeds this
  keep?: number; // generations to retain (file.log.1 .. .N)
}

export function rotateIfNeeded(file: string, opts: RotateOpts = {}): boolean {
  const maxBytes = opts.maxBytes ?? 64 * 1024 * 1024;
  const keep = Math.max(1, opts.keep ?? 3);
  try {
    if (!existsSync(file)) return false;
    if (statSync(file).size < maxBytes) return false;

    // drop the oldest, shift the rest up
    const oldest = `${file}.${keep}`;
    if (existsSync(oldest)) unlinkSync(oldest);
    for (let i = keep - 1; i >= 1; i--) {
      const from = `${file}.${i}`;
      if (existsSync(from)) renameSync(from, `${file}.${i + 1}`);
    }
    renameSync(file, `${file}.1`);
    return true;
  } catch {
    return false; // never propagate: rotation failure must not stop capture
  }
}

/** Total bytes of a log family (live + rotated) — for disk-pressure reporting. */
export function logFamilyBytes(file: string, keep = 3): number {
  let total = 0;
  for (const p of [file, ...Array.from({ length: keep }, (_, i) => `${file}.${i + 1}`)]) {
    try {
      total += statSync(p).size;
    } catch {
      /* absent */
    }
  }
  return total;
}
