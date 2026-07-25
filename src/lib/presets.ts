import { save, open } from '@tauri-apps/plugin-dialog';
import { writeTextFile, readTextFile } from '@tauri-apps/plugin-fs';
import type { PresetData } from '../types';

export async function savePreset(data: Omit<PresetData, 'timestamp'>): Promise<boolean> {
  const path = await save({
    defaultPath: `${data.name || 'preset'}.dbreader.json`,
    filters: [{ name: 'DBReader Preset', extensions: ['dbreader.json', 'json'] }],
  });

  if (!path) return false;

  const preset: PresetData = { ...data, timestamp: Date.now() };
  await writeTextFile(path, JSON.stringify(preset, null, 2));
  return true;
}

export async function loadPreset(): Promise<PresetData | null> {
  const path = await open({
    multiple: false,
    filters: [{ name: 'DBReader Preset', extensions: ['dbreader.json', 'json'] }],
  });
  if (!path || Array.isArray(path)) return null;
  try {
    const content = await readTextFile(path);
    const parsed = JSON.parse(content) as Partial<PresetData>;
    if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
      console.error('Invalid preset: missing nodes or edges arrays');
      return null;
    }
    return {
      name: parsed.name || 'Untitled',
      nodes: parsed.nodes,
      edges: parsed.edges,
      timestamp: parsed.timestamp || Date.now(),
    };
  } catch (err) {
    console.error('Failed to load preset:', err);
    return null;
  }
}
