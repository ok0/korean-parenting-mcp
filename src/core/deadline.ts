import { ToolError } from "./errors.js";

export type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown; timedOut: boolean };

export async function settleWithin<T>(tasks: readonly Promise<T>[], deadlineMs: number): Promise<Settled<T>[]> {
  const out: (Settled<T> | undefined)[] = tasks.map(() => undefined);
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const wrapped = tasks.map((t, i) =>
    t.then(
      (v) => {
        if (!closed) out[i] = { ok: true, value: v };
      },
      (e: unknown) => {
        if (!closed) out[i] = { ok: false, error: e, timedOut: false };
      },
    ),
  );
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, deadlineMs);
    timer.unref?.();
  });
  try {
    await Promise.race([Promise.all(wrapped), timeout]);
  } finally {
    closed = true;
    clearTimeout(timer);
  }
  return out.map(
    (s) =>
      s ?? {
        ok: false,
        error: new ToolError("TIMEOUT", `응답 시간 초과(체인 데드라인 ${deadlineMs}ms)`),
        timedOut: true,
      },
  );
}
