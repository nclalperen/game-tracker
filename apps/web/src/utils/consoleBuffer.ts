type ConsoleLevel = "log" | "info" | "warn" | "error";

const MAX_BUFFER_SIZE = 200;
const buffer: string[] = [];
const originals: Partial<Record<ConsoleLevel, (...args: unknown[]) => void>> = {};
let attached = false;

function formatArg(arg: unknown): string {
  if (typeof arg === "string") return arg;
  if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

function push(level: ConsoleLevel, args: unknown[]) {
  const timestamp = new Date().toISOString();
  const rendered = args.map(formatArg).join(" ");
  const line = `[${timestamp}][${level.toUpperCase()}] ${rendered}`;
  buffer.push(line);
  if (buffer.length > MAX_BUFFER_SIZE) {
    buffer.splice(0, buffer.length - MAX_BUFFER_SIZE);
  }
}

export function attachConsoleProxy(): void {
  if (attached) return;
  attached = true;
  (["log", "info", "warn", "error"] as const).forEach((level) => {
    const original = console[level].bind(console);
    originals[level] = original;
    console[level] = (...args: unknown[]) => {
      try {
        push(level, args);
      } catch {
        // ignore formatting errors
      }
      original(...args);
    };
  });
}

export function getConsoleBufferSnapshot(limit = 50): string[] {
  if (limit <= 0) return [];
  return buffer.slice(-limit);
}
