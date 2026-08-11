import SwiftRs
import Tauri
import UIKit
import WebKit

class CopyArgs: Decodable {
  let uri: String?
  let file_name: String?
}

class PrintArgs: Decodable {
  let html: String
  let title: String?
}

class FileBridgePlugin: Plugin, UIDocumentPickerDelegate, WKNavigationDelegate {
  private var pendingImportInvoke: Invoke?
  private var pendingExportInvoke: Invoke?
  private var pendingPrintInvoke: Invoke?
  private var lastPrintHTML: String?
  private var lastPrintTitle: String?
  private var printWebView: WKWebView?

  private var topViewController: UIViewController? {
    let scenes = UIApplication.shared.connectedScenes
    guard let windowScene = scenes.compactMap({ $0 as? UIWindowScene }).first else {
      return nil
    }
    return windowScene.windows.first(where: { $0.isKeyWindow })?.rootViewController
  }

  private func databasesDirectory() throws -> URL {
    let base = try FileManager.default.url(
      for: .documentDirectory,
      in: .userDomainMask,
      appropriateFor: nil,
      create: true
    )
    let dir = base.appendingPathComponent("databases", isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir
  }

  private func sanitizedFileName(_ name: String?) -> String {
    guard var name = name, !name.isEmpty else { return "dbreader.db" }
    let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "._-"))
    name = name.components(separatedBy: allowed.inverted).joined(separator: "_")
    return name.isEmpty ? "dbreader.db" : name
  }

  @objc public func copyToCache(_ invoke: Invoke) {
    DispatchQueue.main.async {
      guard let top = self.topViewController else {
        invoke.reject("No view controller available")
        return
      }
      self.pendingImportInvoke = invoke
      let picker = UIDocumentPickerViewController(
        forOpeningContentTypes: [.item, .data, .database],
        asCopy: true
      )
      picker.delegate = self
      picker.allowsMultipleSelection = false
      top.present(picker, animated: true)
    }
  }

  @objc public func exportDocument(_ invoke: Invoke) {
    DispatchQueue.main.async {
      guard let top = self.topViewController else {
        invoke.reject("No view controller available")
        return
      }
      let args = try? invoke.parseArgs(CopyArgs.self)
      let source = args?.uri ?? ""
      guard !source.isEmpty, FileManager.default.fileExists(atPath: source) else {
        invoke.reject("Export source file not found")
        return
      }
      self.pendingExportInvoke = invoke
      let picker = UIDocumentPickerViewController(
        forExporting: [URL(fileURLWithPath: source)]
      )
      picker.delegate = self
      top.present(picker, animated: true)
    }
  }

  @objc public func printHtml(_ invoke: Invoke) {
    DispatchQueue.main.async {
      let args = try? invoke.parseArgs(PrintArgs.self)
      guard let html = args?.html else {
        invoke.reject("Missing html payload")
        return
      }
      self.lastPrintHTML = html
      self.lastPrintTitle = args?.title
      self.pendingPrintInvoke = invoke
      let webView = WKWebView(frame: .zero)
      self.printWebView = webView
      webView.navigationDelegate = self
      webView.loadHTMLString(html, baseURL: nil)
    }
  }

  // MARK: UIDocumentPickerDelegate

  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    if let invoke = pendingImportInvoke {
      pendingImportInvoke = nil
      handleImport(urls: urls, invoke: invoke)
    } else if let invoke = pendingExportInvoke {
      pendingExportInvoke = nil
      invoke.resolve(["done": true])
    }
  }

  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    if let invoke = pendingImportInvoke {
      pendingImportInvoke = nil
      invoke.reject("File picker cancelled")
    }
    if let invoke = pendingExportInvoke {
      pendingExportInvoke = nil
      invoke.reject("Export cancelled")
    }
  }

  private func handleImport(urls: [URL], invoke: Invoke) {
    guard let sourceURL = urls.first else {
      invoke.reject("No file selected")
      return
    }
    do {
      let name = sanitizedFileName(sourceURL.lastPathComponent)
      let dir = try databasesDirectory()
      let target = dir.appendingPathComponent(name)
      if FileManager.default.fileExists(atPath: target.path) {
        try FileManager.default.removeItem(at: target)
      }
      do {
        try FileManager.default.copyItem(at: sourceURL, to: target)
      } catch {
        // asCopy already placed the file inside the app's temporary directory
        try FileManager.default.moveItem(at: sourceURL, to: target)
      }
      invoke.resolve(["path": target.path])
    } catch {
      invoke.reject("Failed to copy file: \(error.localizedDescription)")
    }
  }

  // MARK: WKNavigationDelegate

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    guard let invoke = pendingPrintInvoke else { return }
    pendingPrintInvoke = nil
    startPrint(webView: webView, invoke: invoke)
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    guard let invoke = pendingPrintInvoke else { return }
    pendingPrintInvoke = nil
    printWebView = nil
    fallbackHtmlExport(invoke: invoke, reason: error.localizedDescription)
  }

  private func startPrint(webView: WKWebView, invoke: Invoke) {
    printWebView = webView
    guard topViewController != nil else {
      printWebView = nil
      fallbackHtmlExport(invoke: invoke, reason: "Printing not available")
      return
    }
    let controller = UIPrintInteractionController.shared
    controller.printFormatter = webView.viewPrintFormatter()
    controller.present(animated: true) { (_, completed: Bool, error: Error?) in
      DispatchQueue.main.async {
        self.printWebView = nil
        if completed {
          invoke.resolve(["done": true])
        } else {
          self.fallbackHtmlExport(
            invoke: invoke,
            reason: error?.localizedDescription ?? "Print cancelled"
          )
        }
      }
    }
  }

  private func fallbackHtmlExport(invoke: Invoke, reason: String) {
    guard let html = lastPrintHTML, let top = topViewController else {
      invoke.reject(reason)
      return
    }
    var fileName = lastPrintTitle ?? "dbreader-report"
    if !fileName.lowercased().hasSuffix(".html") { fileName += ".html" }
    fileName = fileName.components(separatedBy: CharacterSet.alphanumerics.inverted).joined(separator: "_")
    let path = NSTemporaryDirectory() + fileName
    do {
      try html.write(toFile: path, atomically: true, encoding: .utf8)
    } catch {
      invoke.reject("\(reason). Save failed: \(error.localizedDescription)")
      return
    }
    let url = URL(fileURLWithPath: path)
    let picker = UIDocumentPickerViewController(forExporting: [url])
    picker.delegate = self
    self.pendingExportInvoke = invoke
    top.present(picker, animated: true)
  }
}

@_cdecl("init_plugin_filebridge")
func initPlugin() -> FileBridgePlugin {
  return FileBridgePlugin()
}