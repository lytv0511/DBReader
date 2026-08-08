package com.vincentleong.dbreader

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.result.ActivityResult
import app.tauri.Logger
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream

@InvokeArg
class CopyArgs {
  lateinit var uri: String
  lateinit var file_name: String
}

@TauriPlugin
class FileBridgePlugin(private val activity: Activity) : Plugin(activity) {

  private var exportSourcePath: String? = null

  @Command
  fun copyToCache(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(CopyArgs::class.java)
      val intent = Intent(Intent.ACTION_OPEN_DOCUMENT)
      intent.addCategory(Intent.CATEGORY_OPENABLE)
      intent.type = "*/*"
      startActivityForResult(invoke, intent, "pickDatabaseResult")
    } catch (ex: Exception) {
      val message = ex.message ?: "Failed to pick database file"
      Logger.error(message)
      invoke.reject(message)
    }
  }

  @ActivityCallback
  fun pickDatabaseResult(invoke: Invoke, result: ActivityResult) {
    try {
      when (result.resultCode) {
        Activity.RESULT_OK -> {
          val uri: Uri? = result.data?.data
          if (uri == null) {
            invoke.reject("No file selected")
            return
          }
          val displayName = displayNameFromUri(uri) ?: "imported.db"
          val path = copyUriToFiles(uri, displayName)
          val ret = JSObject()
          ret.put("path", path)
          invoke.resolve(ret)
        }
        Activity.RESULT_CANCELED -> invoke.reject("File picker cancelled")
        else -> invoke.reject("Failed to pick file")
      }
    } catch (ex: java.lang.Exception) {
      val message = ex.message ?: "Failed to read file"
      Logger.error(message)
      invoke.reject(message)
    }
  }

  @Command
  fun exportDocument(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(CopyArgs::class.java)
      exportSourcePath = args.uri.ifBlank { return }
      val intent = Intent(Intent.ACTION_CREATE_DOCUMENT)
      intent.addCategory(Intent.CATEGORY_OPENABLE)
      intent.type = "*/*"
      intent.putExtra(Intent.EXTRA_TITLE, args.file_name.ifBlank { "dbreader.db" })
      startActivityForResult(invoke, intent, "exportDocumentResult")
    } catch (ex: Exception) {
      val message = ex.message ?: "Failed to export database"
      Logger.error(message)
      invoke.reject(message)
    }
  }

  @ActivityCallback
  fun exportDocumentResult(invoke: Invoke, result: ActivityResult) {
    try {
      when (result.resultCode) {
        Activity.RESULT_OK -> {
          val uri: Uri? = result.data?.data
          if (uri == null) {
            invoke.reject("No target file selected")
            return
          }
          exportToUri(uri, invoke)
        }
        Activity.RESULT_CANCELED -> invoke.reject("Export cancelled")
        else -> invoke.reject("Failed to export")
      }
    } catch (ex: java.lang.Exception) {
      val message = ex.message ?: "Failed to export file"
      Logger.error(message)
      invoke.reject(message)
    }
  }

  private fun copyUriToFiles(uri: Uri, displayName: String): String {
    val dir = File(activity.filesDir, "databases")
    if (!dir.exists()) {
      dir.mkdirs()
    }
    val target = File(dir, displayName)
    activity.contentResolver.openInputStream(uri)?.use { input ->
      FileOutputStream(target).use { output ->
        input.copyTo(output)
      }
    } ?: throw IllegalStateException("Could not read selected file")
    try {
      activity.contentResolver.takePersistableUriPermission(
        uri,
        Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
      )
    } catch (_: Exception) {
    }
    return target.absolutePath
  }

  private fun exportToUri(uri: Uri, invoke: Invoke) {
    val source = exportSourcePath ?: throw IllegalStateException("No export source path")
    val file = File(source)
    FileInputStream(file).use { input ->
      activity.contentResolver.openOutputStream(uri)?.use { output ->
        input.copyTo(output)
      } ?: throw IllegalStateException("Could not open target file")
    }
    val ret = JSObject()
    ret.put("done", true)
    invoke.resolve(ret)
  }

  private fun displayNameFromUri(uri: Uri): String? {
    var displayName: String? = null
    val projection = arrayOf(OpenableColumns.DISPLAY_NAME)
    val cursor = activity.contentResolver.query(uri, projection, null, null, null)
    if (cursor != null) {
      if (cursor.moveToFirst()) {
        val columnIdx = cursor.getColumnIndex(projection[0])
        if (columnIdx >= 0) {
          displayName = cursor.getString(columnIdx)
        }
      }
      cursor.close()
    }
    if (displayName.isNullOrEmpty()) {
      displayName = uri.lastPathSegment
    }
    return displayName
  }
}