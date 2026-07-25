import { describe, it, expect } from 'vitest'
import type { ColumnInfo, TableInfo, QueryResult, PresetData, ViewMode } from '../types'

describe('ColumnInfo', () => {
  it('should accept a fully populated column info', () => {
    const col: ColumnInfo = {
      name: 'id',
      data_type: 'INTEGER',
      not_null: true,
      default_value: null,
      primary_key: true,
    }
    expect(col.name).toBe('id')
    expect(col.data_type).toBe('INTEGER')
    expect(col.not_null).toBe(true)
    expect(col.default_value).toBeNull()
    expect(col.primary_key).toBe(true)
  })

  it('should accept nullable default_value', () => {
    const col: ColumnInfo = {
      name: 'name',
      data_type: 'VARCHAR',
      not_null: false,
      default_value: 'default',
      primary_key: false,
    }
    expect(col.default_value).toBe('default')
  })
})

describe('TableInfo', () => {
  it('should accept table info with columns', () => {
    const table: TableInfo = {
      name: 'products',
      columns: [
        { name: 'id', data_type: 'INTEGER', not_null: true, default_value: null, primary_key: true },
        { name: 'name', data_type: 'VARCHAR', not_null: true, default_value: null, primary_key: false },
      ],
    }
    expect(table.name).toBe('products')
    expect(table.columns).toHaveLength(2)
  })

  it('should accept empty columns', () => {
    const table: TableInfo = { name: 'empty', columns: [] }
    expect(table.columns).toHaveLength(0)
  })
})

describe('QueryResult', () => {
  it('should accept SELECT query result', () => {
    const result: QueryResult = {
      columns: ['id', 'name'],
      rows: [[1, 'Alice'], [2, 'Bob']],
      rows_affected: 2,
    }
    expect(result.columns).toEqual(['id', 'name'])
    expect(result.rows).toHaveLength(2)
    expect(result.rows_affected).toBe(2)
  })

  it('should accept mutation query result', () => {
    const result: QueryResult = {
      columns: [],
      rows: [],
      rows_affected: 1,
    }
    expect(result.rows_affected).toBe(1)
  })

  it('should accept null rows_affected', () => {
    const result: QueryResult = {
      columns: ['a'],
      rows: [[null]],
      rows_affected: null,
    }
    expect(result.rows[0][0]).toBeNull()
  })

  it('should handle mixed value types in rows', () => {
    const result: QueryResult = {
      columns: ['name', 'age', 'active'],
      rows: [['Alice', 30, 1]],
      rows_affected: 1,
    }
    expect(result.rows[0][0]).toBe('Alice')
    expect(result.rows[0][1]).toBe(30)
    expect(result.rows[0][2]).toBe(1)
  })
})

describe('PresetData', () => {
  it('should accept valid preset data', () => {
    const preset: PresetData = {
      name: 'My Preset',
      nodes: [{ id: '1', type: 'table', position: { x: 0, y: 0 } }],
      edges: [{ id: 'e1', source: '1', target: '2' }],
      timestamp: 1700000000000,
    }
    expect(preset.name).toBe('My Preset')
    expect(preset.nodes).toHaveLength(1)
    expect(preset.edges).toHaveLength(1)
    expect(preset.timestamp).toBeGreaterThan(0)
  })
})

describe('ViewMode', () => {
  it('should accept all valid view modes', () => {
    const modes: ViewMode[] = [
      'canvas', 'query', 'quickuse', 'dashboard', 'gallery',
      'detail', 'products', 'batches', 'logs', 'adjust', 'used', 'categories',
    ]
    expect(modes).toHaveLength(12)
  })
})
