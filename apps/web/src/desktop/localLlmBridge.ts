import { invoke } from '@tauri-apps/api/core';

export async function localChat(prompt: string): Promise<string> {
  return await invoke<string>('local_llm_chat_cmd', { prompt });
}

export async function localEmbed(texts: string[]): Promise<number[][]> {
  return await invoke<number[][]>('local_llm_embed_cmd', { texts });
}

export type LocalDetect = {
  chat_path: string;
  embed_path: string;
  chat_exists: boolean;
  embed_exists: boolean;
  found?: string[];
};

export async function localDetect(): Promise<LocalDetect> {
  return await invoke<LocalDetect>('local_llm_detect_cmd');
}
