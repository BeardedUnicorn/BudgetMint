// Adapted from TaskMint scripts/brand/android-splash.swift @ ce9f22f.
// Makes the Android splash screen's images from the brand masters:
//
//   swift scripts/brand/android-splash.swift
//
// - splash_icon.png: the leaf (assets/brand/mark.png) on a transparent
//   288 dp square, small enough that all of it, stem included, stays inside
//   the 192 dp circle Android crops a splash icon to.
// - splash_branding.png: the "BudgetMint" wordmark from logo-dark.png (its
//   light "Budget" reads on the splash's teal) in the 200 × 80 dp the branding
//   slot draws (Android 12 and later).
//
// Each goes into res/drawable-{mdpi…xxxhdpi}. The PNGs are committed, so only
// a change to the masters needs this again. macOS only (CoreGraphics).

import CoreGraphics
import Foundation
import ImageIO

let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
  .deletingLastPathComponent()
let brand = root.appendingPathComponent("assets/brand")
let res = root.appendingPathComponent("apps/desktop/src-tauri/gen/android/app/src/main/res")
let densities: [(String, CGFloat)] = [("mdpi", 1), ("hdpi", 1.5), ("xhdpi", 2), ("xxhdpi", 3), ("xxxhdpi", 4)]
let sRGB = CGColorSpace(name: CGColorSpace.sRGB)!

func load(_ name: String) -> CGImage {
  let url = brand.appendingPathComponent(name)
  guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
    let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
  else { fatalError("Can't read \(url.path)") }
  return image
}

func context(_ width: Int, _ height: Int) -> CGContext {
  let context = CGContext(
    data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0, space: sRGB,
    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  context.interpolationQuality = .high
  return context
}

/// Each pixel's alpha, top row first.
func alphas(_ image: CGImage) -> (width: Int, height: Int, at: (Int, Int) -> UInt8) {
  let canvas = context(image.width, image.height)
  canvas.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
  let row = canvas.bytesPerRow
  // A copy: the context's own buffer goes with it
  let data = Array(UnsafeBufferPointer(start: canvas.data!.assumingMemoryBound(to: UInt8.self), count: row * image.height))
  return (image.width, image.height, { x, y in data[y * row + x * 4 + 3] })
}

/// The box (top-left origin) round the pixels that aren't transparent.
func opaqueBounds(_ image: CGImage, fromX: Int = 0) -> CGRect {
  let pixels = alphas(image)
  var (minX, minY, maxX, maxY) = (Int.max, Int.max, -1, -1)
  for y in 0..<pixels.height {
    for x in fromX..<pixels.width where pixels.at(x, y) > 8 {
      minX = min(minX, x)
      minY = min(minY, y)
      maxX = max(maxX, x)
      maxY = max(maxY, y)
    }
  }
  return CGRect(x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1)
}

/// Draws `image` scaled by `scale` with its point `center` (top-left origin)
/// at the middle of a `size` canvas, and writes it to each density.
func write(_ name: String, _ image: CGImage, size: CGSize, scale: CGFloat, center: CGPoint) {
  for (density, factor) in densities {
    let width = Int((size.width * factor).rounded())
    let height = Int((size.height * factor).rounded())
    let canvas = context(width, height)
    let s = scale * factor
    // CoreGraphics' origin is bottom-left
    let rect = CGRect(
      x: CGFloat(width) / 2 - center.x * s,
      y: CGFloat(height) / 2 - (CGFloat(image.height) - center.y) * s,
      width: CGFloat(image.width) * s,
      height: CGFloat(image.height) * s)
    canvas.draw(image, in: rect)
    let folder = res.appendingPathComponent("drawable-\(density)")
    try! FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    let url = folder.appendingPathComponent(name)
    let destination = CGImageDestinationCreateWithURL(url as CFURL, "public.png" as CFString, 1, nil)!
    CGImageDestinationAddImage(destination, canvas.makeImage()!, nil)
    guard CGImageDestinationFinalize(destination) else { fatalError("Can't write \(url.path)") }
    print("\(url.path.replacingOccurrences(of: root.path + "/", with: "")) \(width)×\(height)")
  }
}

// The leaf: as large as fits a 90 dp radius (the mask's is 96 dp) round the
// middle of its drawn pixels, on the 288 dp icon square.
let mark = load("mark.png")
let leaf = opaqueBounds(mark)
let middle = CGPoint(x: leaf.midX, y: leaf.midY)
let pixels = alphas(mark)
var reach: CGFloat = 0
for y in 0..<pixels.height {
  for x in 0..<pixels.width where pixels.at(x, y) > 8 {
    reach = max(reach, hypot(CGFloat(x) + 0.5 - middle.x, CGFloat(y) + 0.5 - middle.y))
  }
}
write("splash_icon.png", mark, size: CGSize(width: 288, height: 288), scale: 90 / reach, center: middle)

// The wordmark: logo-dark.png right of its leaf, 184 × 64 dp at most, in the
// middle of the 200 × 80 dp branding image.
let logo = load("logo-dark.png")
let words = opaqueBounds(logo, fromX: 490)
let fit = min(184 / words.width, 64 / words.height)
write(
  "splash_branding.png", logo.cropping(to: words)!, size: CGSize(width: 200, height: 80), scale: fit,
  center: CGPoint(x: words.width / 2, y: words.height / 2))
