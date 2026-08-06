import { describe, it, expect, vi, beforeEach } from 'vitest'
import { invoke } from '@tauri-apps/api/core'

import {
  openDatabase, getSchema, getTables, getTableColumns, executeQuery, getTableData,
  getDatabasePath, createNewDatabase, closeDatabase, migrateSchema,
  updateBatchStatus, deleteInventoryLog, updateInventoryLogNotes,
  updateProduct, upsertProductAttribute, updateUnitConversion,
  upsertCategory, deleteCategory, getCategoryTemplates,
  upsertCategoryTemplate, deleteCategoryTemplate,
  upsertProductNote, deleteProductNote,
  upsertClient, deleteClient,
  upsertReservation, deleteReservation,
  upsertCalendarEvent, toggleCalendarEvent, deleteCalendarEvent,
  upsertNotification, deleteNotification,
  getProductReportData, savePreferences, loadPreferences,
} from '../lib/db'

const mockInvoke = vi.mocked(invoke)

beforeEach(() => {
  mockInvoke.mockReset()
})

describe('openDatabase', () => {
  it('should invoke open_database with path', async () => {
    mockInvoke.mockResolvedValueOnce({ name: 'test', columns: [] })
    const result = await openDatabase('/tmp/test.db')
    expect(mockInvoke).toHaveBeenCalledWith('open_database', { path: '/tmp/test.db' })
    expect(result).toEqual({ name: 'test', columns: [] })
  })
})

describe('createNewDatabase', () => {
  it('should invoke create_new_database with path', async () => {
    mockInvoke.mockResolvedValueOnce({ name: 'new', columns: [] })
    const result = await createNewDatabase('/tmp/new.db')
    expect(mockInvoke).toHaveBeenCalledWith('create_new_database', { path: '/tmp/new.db' })
    expect(result.name).toBe('new')
  })
})

describe('getTables', () => {
  it('should return list of tables', async () => {
    mockInvoke.mockResolvedValueOnce(['products', 'categories'])
    const tables = await getTables()
    expect(tables).toEqual(['products', 'categories'])
  })
})

describe('getTableColumns', () => {
  it('should invoke with table name', async () => {
    mockInvoke.mockResolvedValueOnce([{ name: 'id', data_type: 'INTEGER', not_null: true, default_value: null, primary_key: true }])
    const cols = await getTableColumns('products')
    expect(mockInvoke).toHaveBeenCalledWith('get_table_columns', { table: 'products' })
    expect(cols[0].name).toBe('id')
  })
})

describe('executeQuery', () => {
  it('should invoke with SQL string', async () => {
    mockInvoke.mockResolvedValueOnce({ columns: ['count'], rows: [[42]], rows_affected: 1 })
    const result = await executeQuery('SELECT COUNT(*) FROM products')
    expect(mockInvoke).toHaveBeenCalledWith('execute_query', { sql: 'SELECT COUNT(*) FROM products' })
    expect(result.rows[0][0]).toBe(42)
  })
})

describe('getTableData', () => {
  it('should invoke with table and optional limit', async () => {
    mockInvoke.mockResolvedValueOnce({ columns: ['id'], rows: [[1]], rows_affected: 1 })
    const result = await getTableData('products', 50)
    expect(mockInvoke).toHaveBeenCalledWith('get_table_data', { table: 'products', limit: 50 })
    expect(result.rows).toHaveLength(1)
  })

  it('should work without limit', async () => {
    mockInvoke.mockResolvedValueOnce({ columns: [], rows: [], rows_affected: 0 })
    await getTableData('products')
    expect(mockInvoke).toHaveBeenCalledWith('get_table_data', { table: 'products', limit: undefined })
  })
})

describe('getDatabasePath', () => {
  it('should return path or null', async () => {
    mockInvoke.mockResolvedValueOnce('/tmp/test.db')
    const path = await getDatabasePath()
    expect(path).toBe('/tmp/test.db')
  })
})

describe('closeDatabase', () => {
  it('should invoke close_database', async () => {
    mockInvoke.mockResolvedValueOnce(undefined)
    await closeDatabase()
    expect(mockInvoke).toHaveBeenCalledWith('close_database')
  })
})

describe('migrateSchema', () => {
  it('should invoke migrate_schema', async () => {
    mockInvoke.mockResolvedValueOnce(undefined)
    await migrateSchema()
    expect(mockInvoke).toHaveBeenCalledWith('migrate_schema')
  })
})

describe('getSchema', () => {
  it('should invoke get_schema', async () => {
    mockInvoke.mockResolvedValueOnce({ name: '', columns: [] })
    const schema = await getSchema()
    expect(schema).toEqual({ name: '', columns: [] })
  })
})

describe('updateBatchStatus', () => {
  it('should invoke with batch id and status', async () => {
    mockInvoke.mockResolvedValueOnce(undefined)
    await updateBatchStatus(1, 'in_inventory')
    expect(mockInvoke).toHaveBeenCalledWith('update_batch_status', { batchId: 1, status: 'in_inventory' })
  })
})

describe('deleteInventoryLog', () => {
  it('should invoke with log id', async () => {
    mockInvoke.mockResolvedValueOnce(undefined)
    await deleteInventoryLog(5)
    expect(mockInvoke).toHaveBeenCalledWith('delete_inventory_log', { logId: 5 })
  })
})

describe('updateInventoryLogNotes', () => {
  it('should invoke with log id and notes', async () => {
    mockInvoke.mockResolvedValueOnce(undefined)
    await updateInventoryLogNotes(5, 'Updated notes')
    expect(mockInvoke).toHaveBeenCalledWith('update_inventory_log_notes', { logId: 5, notes: 'Updated notes' })
  })

  it('should pass null notes', async () => {
    mockInvoke.mockResolvedValueOnce(undefined)
    await updateInventoryLogNotes(5, null)
    expect(mockInvoke).toHaveBeenCalledWith('update_inventory_log_notes', { logId: 5, notes: null })
  })
})

describe('updateProduct', () => {
  it('should invoke with all product fields', async () => {
    mockInvoke.mockResolvedValueOnce(undefined)
    await updateProduct(1, 'New Name', 'SKU-001', 2, 'bottle', 10)
    expect(mockInvoke).toHaveBeenCalledWith('update_product', {
      productId: 1, name: 'New Name', sku: 'SKU-001', categoryId: 2,
      baseUnitName: 'bottle', reorderThreshold: 10,
    })
  })
})

describe('upsertProductAttribute', () => {
  it('should return attribute id', async () => {
    mockInvoke.mockResolvedValueOnce(42)
    const id = await upsertProductAttribute(1, 'Vintage', '2020', 'number')
    expect(id).toBe(42)
    expect(mockInvoke).toHaveBeenCalledWith('upsert_product_attribute', {
      productId: 1, attrKey: 'Vintage', attrValue: '2020', dataType: 'number',
    })
  })
})

describe('updateUnitConversion', () => {
  it('should invoke with conversion fields', async () => {
    mockInvoke.mockResolvedValueOnce(undefined)
    await updateUnitConversion(1, 'Case', 12)
    expect(mockInvoke).toHaveBeenCalledWith('update_unit_conversion', {
      conversionId: 1, unitName: 'Case', conversionFactor: 12,
    })
  })
})

describe('upsertCategory', () => {
  it('should return category id', async () => {
    mockInvoke.mockResolvedValueOnce(10)
    const id = await upsertCategory('Test', 'desc', '🔴', '#ff0000')
    expect(id).toBe(10)
  })

  it('should pass null optionals', async () => {
    mockInvoke.mockResolvedValueOnce(1)
    await upsertCategory('Test', null, null, null)
    expect(mockInvoke).toHaveBeenCalledWith('upsert_category', {
      name: 'Test', description: null, icon: null, color: null,
    })
  })
})

describe('deleteCategory', () => {
  it('should invoke with category id', async () => {
    mockInvoke.mockResolvedValueOnce(undefined)
    await deleteCategory(5)
    expect(mockInvoke).toHaveBeenCalledWith('delete_category', { categoryId: 5 })
  })
})

describe('getCategoryTemplates', () => {
  it('should return templates array', async () => {
    mockInvoke.mockResolvedValueOnce([{ id: 1, attr_key: 'Vintage', attr_type: 'number', is_required: true, display_order: 1 }])
    const templates = await getCategoryTemplates(1)
    expect(templates).toHaveLength(1)
  })
})

describe('upsertCategoryTemplate', () => {
  it('should invoke with template fields', async () => {
    mockInvoke.mockResolvedValueOnce(1)
    const id = await upsertCategoryTemplate(1, 'ABV', 'string', false, 3)
    expect(id).toBe(1)
  })
})

describe('deleteCategoryTemplate', () => {
  it('should invoke with template id', async () => {
    mockInvoke.mockResolvedValueOnce(undefined)
    await deleteCategoryTemplate(1)
    expect(mockInvoke).toHaveBeenCalledWith('delete_category_template', { templateId: 1 })
  })
})

describe('upsertProductNote', () => {
  it('should create note without noteId', async () => {
    mockInvoke.mockResolvedValueOnce(1)
    const id = await upsertProductNote(1, 'Title', 'Body', false)
    expect(id).toBe(1)
    expect(mockInvoke).toHaveBeenCalledWith('upsert_product_note', {
      productId: 1, title: 'Title', body: 'Body', isPinned: false, noteId: null,
    })
  })

  it('should update with noteId', async () => {
    mockInvoke.mockResolvedValueOnce(5)
    const id = await upsertProductNote(1, null, 'Body', true, 5)
    expect(id).toBe(5)
    expect(mockInvoke).toHaveBeenCalledWith('upsert_product_note', {
      productId: 1, title: null, body: 'Body', isPinned: true, noteId: 5,
    })
  })
})

describe('deleteProductNote', () => {
  it('should invoke with note id', async () => {
    mockInvoke.mockResolvedValueOnce(undefined)
    await deleteProductNote(1)
    expect(mockInvoke).toHaveBeenCalledWith('delete_product_note', { noteId: 1 })
  })
})

describe('upsertClient', () => {
  it('should create client without clientId', async () => {
    mockInvoke.mockResolvedValueOnce(1)
    const id = await upsertClient('John', 'john@test.com', null, null, null)
    expect(id).toBe(1)
  })

  it('should update with clientId', async () => {
    mockInvoke.mockResolvedValueOnce(5)
    const id = await upsertClient('John', null, null, null, null, 5)
    expect(id).toBe(5)
  })
})

describe('deleteClient', () => {
  it('should invoke with client id', async () => {
    mockInvoke.mockResolvedValueOnce(undefined)
    await deleteClient(1)
    expect(mockInvoke).toHaveBeenCalledWith('delete_client', { clientId: 1 })
  })
})

describe('upsertReservation', () => {
  it('should create reservation', async () => {
    mockInvoke.mockResolvedValueOnce(1)
    const id = await upsertReservation(1, 2, 3, '2025-01-15', null, null, null)
    expect(id).toBe(1)
  })

  it('should update reservation with reservationId', async () => {
    mockInvoke.mockResolvedValueOnce(10)
    const id = await upsertReservation(1, 2, 3, '2025-01-15', 'fulfilled', 'notes', '2025-01-20', 10)
    expect(id).toBe(10)
  })
})

describe('deleteReservation', () => {
  it('should invoke with reservation id', async () => {
    mockInvoke.mockResolvedValueOnce(undefined)
    await deleteReservation(5)
    expect(mockInvoke).toHaveBeenCalledWith('delete_reservation', { reservationId: 5 })
  })
})

describe('upsertCalendarEvent', () => {
  it('should create event', async () => {
    mockInvoke.mockResolvedValueOnce(1)
    const id = await upsertCalendarEvent(1, 'Tasting', 'tasting', '2025-06-15', null, null, null)
    expect(id).toBe(1)
  })

  it('should update with eventId', async () => {
    mockInvoke.mockResolvedValueOnce(5)
    const id = await upsertCalendarEvent(null, 'Event', 'custom', '2025-07-01', '2025-07-02', 10, 'notes', 5)
    expect(id).toBe(5)
  })
})

describe('toggleCalendarEvent', () => {
  it('should invoke with eventId and isCompleted', async () => {
    mockInvoke.mockResolvedValueOnce(undefined)
    await toggleCalendarEvent(1, true)
    expect(mockInvoke).toHaveBeenCalledWith('toggle_calendar_event', { eventId: 1, isCompleted: true })
  })
})

describe('deleteCalendarEvent', () => {
  it('should invoke with event id', async () => {
    mockInvoke.mockResolvedValueOnce(undefined)
    await deleteCalendarEvent(3)
    expect(mockInvoke).toHaveBeenCalledWith('delete_calendar_event', { eventId: 3 })
  })
})

describe('upsertNotification', () => {
  it('should create notification', async () => {
    mockInvoke.mockResolvedValueOnce(1)
    const id = await upsertNotification(1, 'low_stock', 'Low stock alert', 5.0, true)
    expect(id).toBe(1)
  })

  it('should update with notificationId', async () => {
    mockInvoke.mockResolvedValueOnce(3)
    const id = await upsertNotification(1, 'custom', 'Alert', null, false, 3)
    expect(id).toBe(3)
  })
})

describe('deleteNotification', () => {
  it('should invoke with notification id', async () => {
    mockInvoke.mockResolvedValueOnce(undefined)
    await deleteNotification(2)
    expect(mockInvoke).toHaveBeenCalledWith('delete_notification', { notificationId: 2 })
  })
})

describe('getProductReportData', () => {
  it('should return report data', async () => {
    mockInvoke.mockResolvedValueOnce({ product: { id: 1, name: 'Test' }, attributes: [] })
    const data = await getProductReportData(1)
    expect((data as unknown as { product: { name: string } }).product.name).toBe('Test')
  })
})

describe('savePreferences', () => {
  it('should invoke with full prefs object', async () => {
    mockInvoke.mockResolvedValueOnce(undefined)
    const prefs = {
      lastDbPath: '/tmp/test.db',
      theme: 'dark' as const,
      language: 'en' as const,
      openOnStartup: true,
      defaultQueryLimit: 100,
      inventoryTabOrder: null,
      enabledTabs: null,
      useDefaultTaskbar: true,
      currencySymbol: '$',
      emailAlertsEnabled: false,
      emailSmtpHost: 'smtp.gmail.com',
      emailSmtpPort: 587,
      emailSmtpSecurity: 'starttls' as const,
      emailSender: 'dbreaderauto@gmail.com',
      emailUsername: 'dbreaderauto@gmail.com',
      emailPassword: 'kimlkjrdxfawgmdm',
      emailRecipients: '',
      emailSlots: [
        { enabled: true, time: '08:00', lastFired: null },
        { enabled: true, time: '13:00', lastFired: null },
        { enabled: true, time: '18:00', lastFired: null },
      ],
    }
    await savePreferences(prefs)
    expect(mockInvoke).toHaveBeenCalledWith('save_preferences', { prefs })
  })

  it('should pass null path', async () => {
    mockInvoke.mockResolvedValueOnce(undefined)
    await savePreferences({
      lastDbPath: null,
      theme: 'light' as const,
      language: 'zh-CN' as const,
      openOnStartup: true,
      defaultQueryLimit: 50,
      inventoryTabOrder: null,
      enabledTabs: null,
      useDefaultTaskbar: true,
      currencySymbol: '$',
      emailAlertsEnabled: false,
      emailSmtpHost: 'smtp.gmail.com',
      emailSmtpPort: 587,
      emailSmtpSecurity: 'starttls' as const,
      emailSender: 'dbreaderauto@gmail.com',
      emailUsername: 'dbreaderauto@gmail.com',
      emailPassword: 'kimlkjrdxfawgmdm',
      emailRecipients: '',
      emailSlots: [
        { enabled: true, time: '08:00', lastFired: null },
        { enabled: true, time: '13:00', lastFired: null },
        { enabled: true, time: '18:00', lastFired: null },
      ],
    })
    expect(mockInvoke).toHaveBeenCalledWith('save_preferences', {
      prefs: {
        lastDbPath: null,
        theme: 'light',
        language: 'zh-CN',
        openOnStartup: true,
        defaultQueryLimit: 50,
        inventoryTabOrder: null,
        enabledTabs: null,
        useDefaultTaskbar: true,
        currencySymbol: '$',
        emailAlertsEnabled: false,
        emailSmtpHost: 'smtp.gmail.com',
        emailSmtpPort: 587,
        emailSmtpSecurity: 'starttls',
        emailSender: 'dbreaderauto@gmail.com',
        emailUsername: 'dbreaderauto@gmail.com',
        emailPassword: 'kimlkjrdxfawgmdm',
        emailRecipients: '',
        emailSlots: [
        { enabled: true, time: '08:00', lastFired: null },
        { enabled: true, time: '13:00', lastFired: null },
        { enabled: true, time: '18:00', lastFired: null },
      ],
      },
    })
  })
})

describe('loadPreferences', () => {
  it('should return preferences', async () => {
    mockInvoke.mockResolvedValueOnce({ lastDbPath: '/tmp/test.db' })
    const prefs = await loadPreferences()
    expect(prefs.lastDbPath).toBe('/tmp/test.db')
  })
})
