package com.vincentleong.dbreader

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.print.PrintAttributes
import android.print.PrintJob
import android.print.PrintManager
import android.provider.OpenableColumns
import android.view.Gravity
import android.view.ViewGroup
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.TextView
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

@InvokeArg
class PrintArgs {
  lateinit var html: String
  var title: String = "DBReader Report"
}

@TauriPlugin
class FileBridgePlugin(private val activity: Activity) : Plugin(activity) {

  private var exportSourcePath: String? = null
  private var printPreviewContainer: ViewGroup? = null
  private val mainHandler = Handler(Looper.getMainLooper())

  @Command
  fun copyToCache(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(CopyArgs::class.java)
      val intent = Intent(Intent.ACTION_OPEN_DOCUMENT)
      intent.addCategory(Intent.CATEGORY_OPENABLE)
      intent.type = "*/*"
      intent.putExtra(
        Intent.EXTRA_MIME_TYPES,
        arrayOf(
          "*/*",
          "application/octet-stream",
          "application/x-sqlite3",
          "application/vnd.sqlite3",
          "application/x-sqlite-3"
        )
      )
      startActivityForResult(invoke, intent, "pickDatabaseResult")
    } catch (ex: Exception) {
      val message = ex.message ?: "Failed to pick database file"
      Logger.error(message)
      invoke.reject(message)
    }
  }

  @Command
  fun printHtml(invoke: Invoke) {
    var args: PrintArgs? = null
    try {
      args = invoke.parseArgs(PrintArgs::class.java)
      val jobName = args.title.ifBlank { "DBReader Report" }
      removePrintPreview()
      val webView = WebView(activity)
      webView.layoutParams = FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT
      )
      webView.settings.javaScriptEnabled = false
      webView.setBackgroundColor(Color.WHITE)
      var printed = false
      webView.webViewClient = object : WebViewClient() {
        override fun onPageFinished(view: WebView?, url: String?) {
          if (printed) return
          printed = true
          view?.post {
            try {
              val printManager = activity.getSystemService(Activity.PRINT_SERVICE) as? PrintManager
                ?: throw IllegalStateException("Print service unavailable")
              val printAdapter = view.createPrintDocumentAdapter(jobName)
              val job = printManager.print(
                jobName,
                printAdapter,
                PrintAttributes.Builder().build()
              )
              pollPrintJob(job)
              val ret = JSObject()
              ret.put("done", true)
              invoke.resolve(ret)
            } catch (ex: Exception) {
              startHtmlExport(invoke, args, ex.message ?: "Failed to print")
            }
          }
        }

        @Suppress("DEPRECATION")
        override fun onReceivedError(
          view: WebView?,
          errorCode: Int,
          description: String?,
          failingUrl: String?
        ) {
          if (printed) return
          printed = true
          startHtmlExport(invoke, args, "Failed to load report")
        }
      }

      val dm = activity.resources.displayMetrics
      val container = FrameLayout(activity)
      container.layoutParams = ViewGroup.LayoutParams(dm.widthPixels, dm.heightPixels)
      container.setBackgroundColor(Color.WHITE)
      container.addView(webView)

      val closeBtn = TextView(activity)
      closeBtn.text = "✕"
      closeBtn.textSize = 18f
      closeBtn.setTextColor(Color.WHITE)
      closeBtn.gravity = Gravity.CENTER
      closeBtn.setPadding(0, 0, 0, 0)
      val closeBg = GradientDrawable()
      closeBg.shape = GradientDrawable.OVAL
      closeBg.setColor(0xAA000000.toInt())
      closeBtn.background = closeBg
      val closeLp = FrameLayout.LayoutParams(dp(40), dp(40))
      closeLp.gravity = Gravity.TOP or Gravity.END
      closeLp.setMargins(0, dp(16), dp(16), 0)
      closeBtn.layoutParams = closeLp
      closeBtn.setOnClickListener { removePrintPreview() }
      container.addView(closeBtn)

      printPreviewContainer = container
      activity.addContentView(container, ViewGroup.LayoutParams(dm.widthPixels, dm.heightPixels))
      container.postDelayed({
        removePrintPreview()
      }, 120_000L)
      webView.loadDataWithBaseURL(null, args.html, "text/html", "UTF-8", null)
    } catch (ex: Exception) {
      val message = ex.message ?: "Failed to print"
      Logger.error(message)
      startHtmlExport(invoke, args, message)
    }
  }

  private fun pollPrintJob(job: PrintJob) {
    val check = object : Runnable {
      override fun run() {
        if (job.isCompleted || job.isFailed || job.isCancelled) {
          removePrintPreview()
          return
        }
        mainHandler.postDelayed(this, 500L)
      }
    }
    mainHandler.postDelayed(check, 1000L)
  }

  private fun removePrintPreview() {
    printPreviewContainer?.let { container ->
      (container.parent as? ViewGroup)?.removeView(container)
      printPreviewContainer = null
    }
  }

  private fun dp(value: Int): Int = (value * activity.resources.displayMetrics.density).toInt()

  private fun startHtmlExport(invoke: Invoke, args: PrintArgs?, message: String) {
    if (args == null) {
      invoke.reject(message)
      return
    }
    try {
      var fileName = args.title.ifBlank { "dbreader-report" }
      if (!fileName.endsWith(".html", ignoreCase = true)) fileName = "$fileName.html"
      fileName = fileName.replace(Regex("[^A-Za-z0-9._-]"), "_")
      val cached = File(activity.cacheDir, fileName)
      cached.writeText(args.html, Charsets.UTF_8)
      exportSourcePath = cached.absolutePath
      val intent = Intent(Intent.ACTION_CREATE_DOCUMENT)
      intent.addCategory(Intent.CATEGORY_OPENABLE)
      intent.type = "text/html"
      intent.putExtra(Intent.EXTRA_TITLE, fileName)
      startActivityForResult(invoke, intent, "exportDocumentResult")
    } catch (ex: Exception) {
      invoke.reject(ex.message ?: "Failed to save report")
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