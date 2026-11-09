// Planner-only: render every page of a PDF to PNG so a report's layout can be looked at, not just grepped.
// Usage: swift contracts/tools/pdf-render.swift /tmp/x/report.pdf /tmp/x   → /tmp/x/page1.png, page2.png, …
// Uses macOS PDFKit; no install. Added 2026-11-08 (0184 audit): the narrow-wrap bug passed every text criterion.
import PDFKit
import AppKit
let args = CommandLine.arguments
guard args.count >= 3, let doc = PDFDocument(url: URL(fileURLWithPath: args[1])) else {
  print("usage: swift pdf-render.swift <file.pdf> <out-dir>"); exit(1)
}
for i in 0..<doc.pageCount {
  let image = doc.page(at: i)!.thumbnail(of: NSSize(width: 1100, height: 1556), for: .mediaBox)
  let png = NSBitmapImageRep(data: image.tiffRepresentation!)!.representation(using: .png, properties: [:])!
  try! png.write(to: URL(fileURLWithPath: "\(args[2])/page\(i + 1).png"))
}
print("pages", doc.pageCount)
