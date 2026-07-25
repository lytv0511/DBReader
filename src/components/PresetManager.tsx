import { useState } from 'react';
import { Save, FolderOpen, Trash2 } from 'lucide-react';
import { savePreset, loadPreset } from '../lib/presets';
import type { PresetData } from '../types';
import type { Node, Edge } from 'reactflow';

interface PresetManagerProps {
  nodes: Node[];
  edges: Edge[];
  onLoad?: (preset: PresetData) => void;
}

export default function PresetManager({ nodes, edges, onLoad }: PresetManagerProps) {
  const [presets, setPresets] = useState<PresetData[]>([]);
  const [name, setName] = useState('');

  async function handleSave() {
    const presetName = name.trim() || 'Untitled Preset';
    const success = await savePreset({
      name: presetName,
      nodes: nodes as unknown[],
      edges: edges as unknown[],
    });
    if (success) {
      setPresets((prev) => [
        ...prev.filter((p) => p.name !== presetName),
        { name: presetName, nodes: nodes as unknown[], edges: edges as unknown[], timestamp: Date.now() },
      ]);
      setName('');
    }
  }

  async function handleLoad() {
    const preset = await loadPreset();
    if (preset) {
      setPresets((prev) => [
        ...prev.filter((p) => p.name !== preset.name),
        preset,
      ]);
      onLoad?.(preset);
    }
  }

  function handleDelete(presetName: string) {
    setPresets((prev) => prev.filter((p) => p.name !== presetName));
  }

  return (
    <div className="flex flex-col gap-3 p-3 border-t border-border">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Preset name..."
          className="flex-1 px-2 py-1 bg-bg-primary border border-border rounded-md text-xs text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-border-focus"
        />
        <button
          onClick={handleSave}
          className="flex items-center gap-1 px-2 py-1 bg-accent hover:bg-accent-hover rounded-md text-xs text-white transition-colors"
        >
          <Save size={10} /> Save
        </button>
        <button
          onClick={handleLoad}
          className="flex items-center gap-1 px-2 py-1 bg-bg-tertiary hover:bg-bg-hover border border-border rounded-md text-xs text-text-secondary transition-colors"
        >
          <FolderOpen size={10} /> Load
        </button>
      </div>

      {presets.length > 0 && (
        <div className="flex flex-col gap-1">
          {presets.map((p) => (
            <div
              key={p.name}
              className="flex items-center justify-between px-2 py-1 bg-bg-tertiary rounded-md text-xs"
            >
              <button
                onClick={() => onLoad?.(p)}
                className="text-text-primary hover:text-accent truncate flex-1 text-left"
              >
                {p.name}
              </button>
              <button
                onClick={() => handleDelete(p.name)}
                className="text-text-secondary hover:text-error ml-2"
              >
                <Trash2 size={10} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
