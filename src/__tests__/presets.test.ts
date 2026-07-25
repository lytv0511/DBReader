import { describe, it, expect, vi, beforeEach } from 'vitest'
import { save as dialogSave, open as dialogOpen } from '@tauri-apps/plugin-dialog'
import { writeTextFile, readTextFile } from '@tauri-apps/plugin-fs'
import { savePreset, loadPreset } from '../lib/presets'

const mockDialogSave = vi.mocked(dialogSave)
const mockDialogOpen = vi.mocked(dialogOpen)
const mockWriteTextFile = vi.mocked(writeTextFile)
const mockReadTextFile = vi.mocked(readTextFile)

beforeEach(() => {
  vi.resetAllMocks()
})

describe('savePreset', () => {
  it('should return true on successful save', async () => {
    mockDialogSave.mockResolvedValueOnce('/tmp/test-preset.dbreader.json')
    mockWriteTextFile.mockResolvedValueOnce(undefined)

    const result = await savePreset({
      name: 'Test Preset',
      nodes: [{ id: '1' }],
      edges: [{ id: 'e1', source: '1', target: '2' }],
    })

    expect(result).toBe(true)
    expect(mockDialogSave).toHaveBeenCalledWith({
      defaultPath: 'Test Preset.dbreader.json',
      filters: [{ name: 'DBReader Preset', extensions: ['dbreader.json', 'json'] }],
    })
    expect(mockWriteTextFile).toHaveBeenCalledOnce()
  })

  it('should return false when dialog is cancelled', async () => {
    mockDialogSave.mockResolvedValueOnce(null)

    const result = await savePreset({
      name: 'Cancelled',
      nodes: [],
      edges: [],
    })

    expect(result).toBe(false)
    expect(mockWriteTextFile).not.toHaveBeenCalled()
  })

  it('should use fallback filename when name is empty', async () => {
    mockDialogSave.mockResolvedValueOnce('/tmp/preset.dbreader.json')
    mockWriteTextFile.mockResolvedValueOnce(undefined)

    await savePreset({
      name: '',
      nodes: [],
      edges: [],
    })

    expect(mockDialogSave).toHaveBeenCalledWith({
      defaultPath: 'preset.dbreader.json',
      filters: [{ name: 'DBReader Preset', extensions: ['dbreader.json', 'json'] }],
    })
  })
})

describe('loadPreset', () => {
  it('should return parsed preset on success', async () => {
    mockDialogOpen.mockResolvedValueOnce('/tmp/test.dbreader.json')
    mockReadTextFile.mockResolvedValueOnce(JSON.stringify({
      name: 'Loaded Preset',
      nodes: [{ id: '1', type: 'table' }],
      edges: [{ id: 'e1', source: '1', target: '2' }],
      timestamp: 1700000000000,
    }))

    const preset = await loadPreset()

    expect(preset).not.toBeNull()
    expect(preset!.name).toBe('Loaded Preset')
    expect(preset!.nodes).toHaveLength(1)
    expect(preset!.edges).toHaveLength(1)
    expect(preset!.timestamp).toBe(1700000000000)
  })

  it('should return null when dialog is cancelled', async () => {
    mockDialogOpen.mockResolvedValueOnce(null)

    const preset = await loadPreset()
    expect(preset).toBeNull()
  })

  it('should handle array paths (multi-select) by returning null', async () => {
    mockDialogOpen.mockResolvedValueOnce(['/tmp/a.json', '/tmp/b.json'])

    const preset = await loadPreset()
    expect(preset).toBeNull()
  })

  it('should return null for invalid JSON', async () => {
    mockDialogOpen.mockResolvedValueOnce('/tmp/test.dbreader.json')
    mockReadTextFile.mockResolvedValueOnce('not json')

    const preset = await loadPreset()
    expect(preset).toBeNull()
  })

  it('should return null when nodes is missing', async () => {
    mockDialogOpen.mockResolvedValueOnce('/tmp/test.dbreader.json')
    mockReadTextFile.mockResolvedValueOnce(JSON.stringify({
      name: 'Bad',
      edges: [],
    }))

    const preset = await loadPreset()
    expect(preset).toBeNull()
  })

  it('should return null when edges is missing', async () => {
    mockDialogOpen.mockResolvedValueOnce('/tmp/test.dbreader.json')
    mockReadTextFile.mockResolvedValueOnce(JSON.stringify({
      name: 'Bad',
      nodes: [],
    }))

    const preset = await loadPreset()
    expect(preset).toBeNull()
  })

  it('should supply defaults for missing optional fields', async () => {
    mockDialogOpen.mockResolvedValueOnce('/tmp/test.dbreader.json')
    mockReadTextFile.mockResolvedValueOnce(JSON.stringify({
      nodes: [],
      edges: [],
    }))

    const preset = await loadPreset()
    expect(preset).not.toBeNull()
    expect(preset!.name).toBe('Untitled')
    expect(preset!.timestamp).toBeGreaterThan(0)
  })

  it('should handle read errors gracefully', async () => {
    mockDialogOpen.mockResolvedValueOnce('/tmp/test.dbreader.json')
    mockReadTextFile.mockRejectedValueOnce(new Error('File not found'))

    const preset = await loadPreset()
    expect(preset).toBeNull()
  })
})
