import AppKit

let coral = NSColor(srgbRed: 227 / 255, green: 109 / 255, blue: 79 / 255, alpha: 1)
let outDir = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "public")

func font(size: CGFloat) -> NSFont {
  NSFont(name: "Kohinoor Devanagari Bold", size: size)
    ?? NSFont(name: "KohinoorDevanagari-Bold", size: size)
    ?? NSFont(name: "DevanagariMT-Bold", size: size)
    ?? NSFont.systemFont(ofSize: size, weight: .bold)
}

func png(size: Int, glyphRatio: CGFloat) -> Data {
  let scale = CGFloat(size)
  let colorSpace = CGColorSpaceCreateDeviceRGB()
  guard let ctx = CGContext(
    data: nil,
    width: size,
    height: size,
    bitsPerComponent: 8,
    bytesPerRow: 0,
    space: colorSpace,
    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
  ) else {
    fputs("no context\n", stderr)
    exit(1)
  }
  ctx.setFillColor(coral.cgColor)
  ctx.fill(CGRect(x: 0, y: 0, width: scale, height: scale))

  let glyph = NSAttributedString(string: "स", attributes: [
    .font: font(size: scale * glyphRatio),
    .foregroundColor: NSColor.white,
  ])
  let glyphSize = glyph.size()
  let origin = CGPoint(
    x: (scale - glyphSize.width) / 2,
    y: (scale - glyphSize.height) / 2 - scale * 0.03
  )
  let ns = NSGraphicsContext(cgContext: ctx, flipped: false)
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = ns
  glyph.draw(at: origin)
  NSGraphicsContext.restoreGraphicsState()

  guard let image = ctx.makeImage() else {
    fputs("no image\n", stderr)
    exit(1)
  }
  let bitmap = NSBitmapImageRep(cgImage: image)
  bitmap.size = NSSize(width: size, height: size)
  guard let data = bitmap.representation(using: .png, properties: [:]) else {
    fputs("no png\n", stderr)
    exit(1)
  }
  return data
}

func write(_ data: Data, name: String) {
  let url = outDir.appendingPathComponent(name)
  try! data.write(to: url)
  fputs("wrote \(url.path)\n", stderr)
}

try FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)
write(png(size: 1024, glyphRatio: 0.58), name: "icon.png")
write(png(size: 192, glyphRatio: 0.58), name: "pwa-192.png")
write(png(size: 512, glyphRatio: 0.58), name: "pwa-512.png")
write(png(size: 512, glyphRatio: 0.42), name: "pwa-maskable-512.png")
write(png(size: 180, glyphRatio: 0.58), name: "apple-touch-icon.png")
write(png(size: 48, glyphRatio: 0.58), name: "favicon.png")
