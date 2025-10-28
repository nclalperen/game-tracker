import { invoke } from '@tauri-apps/api/core';

export async function allyVersion(): Promise<string> {
  return await invoke<string>('ally_version_cmd');
}

export async function allyGetDataDir(): Promise<string> {
  return await invoke<string>('ally_get_data_dir');
}

export async function allyWriteExport(label: string, filename: string, contents: string): Promise<number> {
  return await invoke<number>('ally_write_export', { label, filename, contents });
}

export async function allyEmbed(label: string = 'my_library'): Promise<string> {
  return await invoke<string>('ally_embed_cmd', { label });
}

export async function allyStartRag(label: string = 'my_library'): Promise<string> {
  return await invoke<string>('ally_start_rag_cmd', { label });
}

export async function allyChat(session: string, message: string, allowWeb = false): Promise<string> {
  return await invoke<string>('ally_chat_cmd', { session, message, allowWeb });
}
