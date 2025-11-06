declare module "@tauri-apps/api/core" {
  export function invoke<T = unknown>(
    cmd: string,
    args?: Record<string, unknown>,
  ): Promise<T>;
}

declare module "@tauri-apps/plugin-process" {
  export function relaunch(): Promise<void>;
}

declare module "@tauri-apps/plugin-updater" {
  export type UpdateStatus = "UP_TO_DATE" | "PENDING" | "DOWNLOADED" | "ERROR";
  export type UpdateInfo = {
    status?: UpdateStatus;
    version?: string | null;
    downloadUrl?: string | null;
    shouldUpdate?: boolean;
    manifest?: { version?: string | null } | null;
    downloadAndInstall: () => Promise<void>;
    install: () => Promise<void>;
    close: () => Promise<void>;
  };

  export function check(): Promise<UpdateInfo>;
  export function install(): Promise<void>;
}
