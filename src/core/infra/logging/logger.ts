export type LogLevel = "debug" | "info" | "warn" | "error";

type LogPayload = Record<string, unknown>;

function maskEmail(email?: string | null): string | null {
  if (!email) return null;
  const [name, domain] = email.split("@");
  if (!domain || name.length === 0) return null;
  return `${name[0]}***@${domain}`;
}

function emit(level: LogLevel, event: string, payload: LogPayload = {}): void {
  const row = {
    timestamp: new Date().toISOString(),
    level,
    event,
    payload,
  };

  const serialized = JSON.stringify(row);

  if (level === "error") {
    console.error(serialized);
    return;
  }

  if (level === "warn") {
    console.warn(serialized);
    return;
  }

  console.log(serialized);
}

export const logger = {
  debug(event: string, payload?: LogPayload): void {
    emit("debug", event, payload);
  },
  info(event: string, payload?: LogPayload): void {
    emit("info", event, payload);
  },
  warn(event: string, payload?: LogPayload): void {
    emit("warn", event, payload);
  },
  error(event: string, payload?: LogPayload): void {
    emit("error", event, payload);
  },
  maskEmail,
};
