import { invoke } from '@tauri-apps/api/core';
import type { AppPreferences } from '../types';
import type { ColumnInfo, QueryResult, TableInfo } from '../types';

export async function openDatabase(path: string): Promise<TableInfo> {
  return invoke<TableInfo>('open_database', { path });
}

export async function getSchema(): Promise<TableInfo> {
  return invoke<TableInfo>('get_schema');
}

export async function getTables(): Promise<string[]> {
  return invoke<string[]>('get_tables');
}

export async function getTableColumns(table: string): Promise<ColumnInfo[]> {
  return invoke<ColumnInfo[]>('get_table_columns', { table });
}

export async function executeQuery(sql: string): Promise<QueryResult> {
  return invoke<QueryResult>('execute_query', { sql });
}

export async function getTableData(table: string, limit?: number): Promise<QueryResult> {
  return invoke<QueryResult>('get_table_data', { table, limit });
}

export async function getDatabasePath(): Promise<string | null> {
  return invoke<string | null>('get_database_path');
}

export async function createNewDatabase(path: string): Promise<TableInfo> {
  return invoke<TableInfo>('create_new_database', { path });
}

export async function closeDatabase(): Promise<void> {
  return invoke<void>('close_database');
}

export async function migrateSchema(): Promise<void> {
  return invoke<void>('migrate_schema');
}

export async function updateBatchStatus(batchId: number, status: string): Promise<void> {
  return invoke<void>('update_batch_status', { batchId, status });
}

export async function deleteInventoryLog(logId: number): Promise<void> {
  return invoke<void>('delete_inventory_log', { logId });
}

export async function updateInventoryLogNotes(logId: number, notes: string | null): Promise<void> {
  return invoke<void>('update_inventory_log_notes', { logId, notes });
}

export async function updateProduct(
  productId: number,
  name: string,
  sku: string | null,
  categoryId: number | null,
  baseUnitName: string,
  reorderThreshold: number
): Promise<void> {
  return invoke<void>('update_product', { productId, name, sku, categoryId, baseUnitName, reorderThreshold });
}

export async function upsertProductAttribute(
  productId: number,
  attrKey: string,
  attrValue: string,
  dataType: string
): Promise<number> {
  return invoke<number>('upsert_product_attribute', { productId, attrKey, attrValue, dataType });
}

export async function updateUnitConversion(
  conversionId: number,
  unitName: string,
  conversionFactor: number
): Promise<void> {
  return invoke<void>('update_unit_conversion', { conversionId, unitName, conversionFactor });
}

export async function upsertCategory(
  name: string,
  description: string | null,
  icon: string | null,
  color: string | null
): Promise<number> {
  return invoke<number>('upsert_category', { name, description, icon, color });
}

export async function deleteCategory(categoryId: number): Promise<void> {
  return invoke<void>('delete_category', { categoryId });
}

export async function getCategoryTemplates(categoryId: number): Promise<Record<string, unknown>[]> {
  return invoke<Record<string, unknown>[]>('get_category_templates', { categoryId });
}

export async function upsertCategoryTemplate(
  categoryId: number,
  attrKey: string,
  attrType: string,
  isRequired: boolean,
  displayOrder: number
): Promise<number> {
  return invoke<number>('upsert_category_template', { categoryId, attrKey, attrType, isRequired, displayOrder });
}

export async function deleteCategoryTemplate(templateId: number): Promise<void> {
  return invoke<void>('delete_category_template', { templateId });
}

export async function upsertProductNote(
  productId: number, title: string | null, body: string, isPinned: boolean, noteId?: number
): Promise<number> {
  return invoke<number>('upsert_product_note', { productId, title, body, isPinned, noteId: noteId ?? null });
}

export async function deleteProductNote(noteId: number): Promise<void> {
  return invoke<void>('delete_product_note', { noteId });
}

export async function upsertClient(
  name: string, email: string | null, phone: string | null, company: string | null, notes: string | null, clientId?: number
): Promise<number> {
  return invoke<number>('upsert_client', { name, email, phone, company, notes, clientId: clientId ?? null });
}

export async function deleteClient(clientId: number): Promise<void> {
  return invoke<void>('delete_client', { clientId });
}

export async function upsertReservation(
  clientId: number, productId: number, quantity: number, reservedDate: string,
  status: string | null, notes: string | null, fulfilledDate: string | null, reservationId?: number
): Promise<number> {
  return invoke<number>('upsert_reservation', { clientId, productId, quantity, reservedDate, status, notes, fulfilledDate, reservationId: reservationId ?? null });
}

export async function deleteReservation(reservationId: number): Promise<void> {
  return invoke<void>('delete_reservation', { reservationId });
}

export async function upsertCalendarEvent(
  productId: number | null, title: string, eventType: string, eventDate: string,
  endDate: string | null, quantity: number | null, notes: string | null, eventId?: number
): Promise<number> {
  return invoke<number>('upsert_calendar_event', { productId, title, eventType, eventDate, endDate, quantity, notes, eventId: eventId ?? null });
}

export async function toggleCalendarEvent(eventId: number, isCompleted: boolean): Promise<void> {
  return invoke<void>('toggle_calendar_event', { eventId, isCompleted });
}

export async function deleteCalendarEvent(eventId: number): Promise<void> {
  return invoke<void>('delete_calendar_event', { eventId });
}

export async function upsertNotification(
  productId: number, notificationType: string, message: string,
  thresholdValue: number | null, isActive: boolean, notificationId?: number
): Promise<number> {
  return invoke<number>('upsert_notification', { productId, notificationType, message, thresholdValue, isActive, notificationId: notificationId ?? null });
}

export async function deleteNotification(notificationId: number): Promise<void> {
  return invoke<void>('delete_notification', { notificationId });
}

export async function getProductReportData(productId: number): Promise<Record<string, unknown>> {
  return invoke<Record<string, unknown>>('get_product_report_data', { productId });
}

export async function savePreferences(prefs: AppPreferences): Promise<void> {
  return invoke<void>('save_preferences', { prefs });
}

export async function loadPreferences(): Promise<AppPreferences> {
  return invoke<AppPreferences>('load_preferences');
}
