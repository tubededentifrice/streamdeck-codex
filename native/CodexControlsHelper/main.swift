import AppKit
import ApplicationServices
import Foundation
import Vision

private let codexBundleIdentifier = "com.openai.codex"
private let errorPrefix = "CODEX_CONTROLS_ERROR:"
private let modelControlRoles = [kAXPopUpButtonRole as String, "AXMenuButton"]

private enum HelperError: String, Error {
  case accessDenied = "access_denied"
  case appNotRunning = "app_not_running"
  case windowNotFound = "window_not_found"
  case controlMissing = "control_missing"
  case controlAmbiguous = "control_ambiguous"
  case pressFailed = "press_failed"
  case targetMissing = "target_missing"
  case targetAmbiguous = "target_ambiguous"
  case selectionFailed = "selection_failed"
  case screenRecordingDenied = "screen_recording_denied"
  case screenCaptureFailed = "screen_capture_failed"
  case invalidArguments = "invalid_arguments"
}

private func attribute(_ name: CFString, of element: AXUIElement) -> CFTypeRef? {
  var value: CFTypeRef?
  guard AXUIElementCopyAttributeValue(element, name, &value) == .success else {
    return nil
  }
  return value
}

private func stringAttribute(_ name: CFString, of element: AXUIElement) -> String? {
  attribute(name, of: element) as? String
}

private func children(of element: AXUIElement) -> [AXUIElement] {
  attribute(kAXChildrenAttribute as CFString, of: element) as? [AXUIElement] ?? []
}

private func elementAttribute(_ name: CFString, of element: AXUIElement) -> AXUIElement? {
  guard let value = attribute(name, of: element),
    CFGetTypeID(value) == AXUIElementGetTypeID()
  else { return nil }
  return unsafeBitCast(value, to: AXUIElement.self)
}

private func pointAttribute(_ name: CFString, of element: AXUIElement) -> CGPoint? {
  guard let value = attribute(name, of: element),
    CFGetTypeID(value) == AXValueGetTypeID()
  else { return nil }
  let axValue = unsafeBitCast(value, to: AXValue.self)
  guard AXValueGetType(axValue) == .cgPoint else { return nil }
  var point = CGPoint.zero
  return AXValueGetValue(axValue, .cgPoint, &point) ? point : nil
}

private func sizeAttribute(_ name: CFString, of element: AXUIElement) -> CGSize? {
  guard let value = attribute(name, of: element),
    CFGetTypeID(value) == AXValueGetTypeID()
  else { return nil }
  let axValue = unsafeBitCast(value, to: AXValue.self)
  guard AXValueGetType(axValue) == .cgSize else { return nil }
  var size = CGSize.zero
  return AXValueGetValue(axValue, .cgSize, &size) ? size : nil
}

private func unique(_ elements: [AXUIElement]) -> [AXUIElement] {
  var result: [AXUIElement] = []
  for element in elements where !result.contains(where: { CFEqual($0, element) }) {
    result.append(element)
  }
  return result
}

private func actionNames(of element: AXUIElement) -> [String] {
  var names: CFArray?
  guard AXUIElementCopyActionNames(element, &names) == .success else { return [] }
  return names as? [String] ?? []
}

private func elementAtPosition(
  _ systemWide: AXUIElement,
  x: CGFloat,
  y: CGFloat
) -> AXUIElement? {
  var element: AXUIElement?
  guard
    AXUIElementCopyElementAtPosition(
      systemWide,
      Float(x),
      Float(y),
      &element
    ) == .success
  else { return nil }
  return element
}

private func actionableTarget(
  from hitElement: AXUIElement,
  targetLabel: String
) -> AXUIElement? {
  guard values(of: hitElement).contains(targetLabel) else { return nil }
  var element = hitElement
  for _ in 0..<12 {
    if actionNames(of: element).contains(kAXPressAction as String) {
      return element
    }
    guard let parent = elementAttribute(kAXParentAttribute as CFString, of: element) else {
      break
    }
    element = parent
  }
  return nil
}

private func targetCandidatesAround(
  control: AXUIElement,
  targetLabel: String
) -> [AXUIElement] {
  guard let position = pointAttribute(kAXPositionAttribute as CFString, of: control),
    let size = sizeAttribute(kAXSizeAttribute as CFString, of: control)
  else { return [] }
  let systemWide = AXUIElementCreateSystemWide()
  let minimumX = position.x - 350
  let maximumX = position.x + size.width + 350
  let minimumY = position.y - 900
  let maximumY = position.y + size.height + 300
  var candidates = [AXUIElement]()
  var y = minimumY
  while y <= maximumY {
    var x = minimumX
    while x <= maximumX {
      if let hit = elementAtPosition(systemWide, x: x, y: y),
        let candidate = actionableTarget(from: hit, targetLabel: targetLabel)
      {
        candidates.append(candidate)
      }
      x += 12
    }
    y += 12
  }
  return unique(candidates)
}

private func activeDisplayBounds() -> CGRect? {
  var displayCount: UInt32 = 0
  guard CGGetActiveDisplayList(0, nil, &displayCount) == .success,
    displayCount > 0
  else { return nil }
  var displays = [CGDirectDisplayID](repeating: 0, count: Int(displayCount))
  guard CGGetActiveDisplayList(displayCount, &displays, &displayCount) == .success else {
    return nil
  }
  return displays.prefix(Int(displayCount)).reduce(nil as CGRect?) { result, display in
    let bounds = CGDisplayBounds(display)
    return result?.union(bounds) ?? bounds
  }
}

private func normalizedOCRText(_ text: String) -> String {
  text.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
}

private func captureMenuRegion(around control: AXUIElement) throws -> (CGImage, CGRect) {
  guard CGPreflightScreenCaptureAccess() || CGRequestScreenCaptureAccess() else {
    throw HelperError.screenRecordingDenied
  }
  guard let position = pointAttribute(kAXPositionAttribute as CFString, of: control),
    let size = sizeAttribute(kAXSizeAttribute as CFString, of: control),
    let displayBounds = activeDisplayBounds()
  else { throw HelperError.screenCaptureFailed }
  let requested = CGRect(
    x: position.x - 500,
    y: position.y - 900,
    width: size.width + 1_000,
    height: size.height + 1_200
  )
  let captureBounds = requested.intersection(displayBounds)
  guard !captureBounds.isNull, !captureBounds.isEmpty,
    let image = CGWindowListCreateImage(
      captureBounds,
      .optionOnScreenOnly,
      kCGNullWindowID,
      [.bestResolution, .boundsIgnoreFraming]
    )
  else { throw HelperError.screenCaptureFailed }
  return (image, captureBounds)
}

private func exactOCRTargetCenter(
  control: AXUIElement,
  targetLabel: String
) throws -> CGPoint {
  let (image, captureBounds) = try captureMenuRegion(around: control)
  let request = VNRecognizeTextRequest()
  request.recognitionLevel = .accurate
  request.usesLanguageCorrection = false
  let handler = VNImageRequestHandler(cgImage: image, options: [:])
  do {
    try handler.perform([request])
  } catch {
    throw HelperError.screenCaptureFailed
  }
  let expected = normalizedOCRText(targetLabel)
  let matches = (request.results ?? []).compactMap { observation -> CGRect? in
    guard let candidate = observation.topCandidates(1).first,
      normalizedOCRText(candidate.string) == expected
    else { return nil }
    return observation.boundingBox
  }
  guard !matches.isEmpty else { throw HelperError.targetMissing }
  guard matches.count == 1, let match = matches.first else {
    throw HelperError.targetAmbiguous
  }
  return CGPoint(
    x: captureBounds.minX + match.midX * captureBounds.width,
    y: captureBounds.minY + (1 - match.midY) * captureBounds.height
  )
}

private func click(_ point: CGPoint) throws {
  guard
    let mouseDown = CGEvent(
      mouseEventSource: nil,
      mouseType: .leftMouseDown,
      mouseCursorPosition: point,
      mouseButton: .left
    ),
    let mouseUp = CGEvent(
      mouseEventSource: nil,
      mouseType: .leftMouseUp,
      mouseCursorPosition: point,
      mouseButton: .left
    )
  else { throw HelperError.selectionFailed }
  mouseDown.post(tap: .cghidEventTap)
  mouseUp.post(tap: .cghidEventTap)
}

private func descendants(of root: AXUIElement, maximum: Int = 12_000) -> [AXUIElement] {
  var pending = [root]
  var result: [AXUIElement] = []
  while !pending.isEmpty && result.count < maximum {
    let element = pending.removeLast()
    result.append(element)
    pending.append(contentsOf: children(of: element))
  }
  return result
}

private func values(of element: AXUIElement) -> [String] {
  [
    stringAttribute(kAXTitleAttribute as CFString, of: element),
    stringAttribute(kAXValueAttribute as CFString, of: element),
    stringAttribute(kAXDescriptionAttribute as CFString, of: element),
  ].compactMap { $0 }
}

private func trusted(prompt: Bool) -> Bool {
  let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: prompt]
  return AXIsProcessTrustedWithOptions(options as CFDictionary)
}

private func codexApplication() throws -> (NSRunningApplication, AXUIElement) {
  guard trusted(prompt: true) else { throw HelperError.accessDenied }
  let applications = NSRunningApplication.runningApplications(
    withBundleIdentifier: codexBundleIdentifier
  )
  guard applications.count == 1, let application = applications.first else {
    throw HelperError.appNotRunning
  }
  _ = application.activate(options: [.activateIgnoringOtherApps])
  Thread.sleep(forTimeInterval: 0.1)
  return (application, AXUIElementCreateApplication(application.processIdentifier))
}

private func frontWindow(of application: AXUIElement) throws -> AXUIElement {
  if let window = elementAttribute(kAXFocusedWindowAttribute as CFString, of: application) {
    return window
  }
  if let window = elementAttribute(kAXMainWindowAttribute as CFString, of: application) {
    return window
  }
  throw HelperError.windowNotFound
}

private func exactMatches(
  in elements: [AXUIElement],
  roles: Set<String>,
  label: String
) -> [AXUIElement] {
  unique(
    elements.filter { element in
      guard let role = stringAttribute(kAXRoleAttribute as CFString, of: element),
        roles.contains(role)
      else { return false }
      return values(of: element).contains(label)
    })
}

private func update(currentLabel: String, targetLabel: String) throws {
  let (_, application) = try codexApplication()
  let window = try frontWindow(of: application)
  let controls = exactMatches(
    in: descendants(of: window),
    roles: Set(modelControlRoles),
    label: currentLabel
  )
  guard !controls.isEmpty else { throw HelperError.controlMissing }
  guard controls.count == 1, let control = controls.first else {
    throw HelperError.controlAmbiguous
  }
  if currentLabel == targetLabel { return }
  guard AXUIElementPerformAction(control, kAXPressAction as CFString) == .success else {
    throw HelperError.pressFailed
  }
  Thread.sleep(forTimeInterval: 0.2)
  let menuItems = targetCandidatesAround(control: control, targetLabel: targetLabel)
  if menuItems.count > 1 {
    _ = AXUIElementPerformAction(control, kAXPressAction as CFString)
    throw HelperError.targetAmbiguous
  }
  if let menuItem = menuItems.first {
    guard AXUIElementPerformAction(menuItem, kAXPressAction as CFString) == .success else {
      throw HelperError.selectionFailed
    }
  } else {
    do {
      try click(exactOCRTargetCenter(control: control, targetLabel: targetLabel))
    } catch {
      _ = AXUIElementPerformAction(control, kAXPressAction as CFString)
      throw error
    }
  }
  for _ in 0..<20 {
    let updatedControls = exactMatches(
      in: descendants(of: window),
      roles: Set(modelControlRoles),
      label: targetLabel
    )
    if updatedControls.count == 1 { return }
    Thread.sleep(forTimeInterval: 0.05)
  }
  throw HelperError.selectionFailed
}

private func isModelSettingLabel(_ value: String) -> Bool {
  let lowered = value.lowercased()
  let efforts = [
    "none", "minimal", "light", "medium", "high", "extra high", "max", "ultra",
  ]
  let hasEffort = efforts.contains { lowered.contains($0) }
  let hasVersion =
    value.range(
      of:
        #"^(?:GPT[- ]?)?[0-9]+(?:\.[0-9]+)+(?: [A-Za-z0-9-]+)* (?:None|Minimal|Light|Medium|High|Extra High|Max|Ultra)$"#,
      options: [.regularExpression, .caseInsensitive]
    ) != nil
  return hasEffort && hasVersion
}

private func isSafeModelText(_ value: String, currentLabel: String?) -> Bool {
  (value == currentLabel || isModelSettingLabel(value)) && isModelSettingLabel(value)
}

private func safeDescription(
  of element: AXUIElement,
  currentLabel: String,
  allowedRoles: Set<String>? = nil
) -> [String: String]? {
  guard let role = stringAttribute(kAXRoleAttribute as CFString, of: element),
    allowedRoles?.contains(role) ?? true
  else { return nil }
  var item = ["role": role]
  let safeAttributes: [(String, CFString)] = [
    ("name", kAXTitleAttribute as CFString),
    ("value", kAXValueAttribute as CFString),
    ("description", kAXDescriptionAttribute as CFString),
  ]
  for (key, attributeName) in safeAttributes {
    if let value = stringAttribute(attributeName, of: element),
      isSafeModelText(value, currentLabel: currentLabel)
    {
      item[key] = value
    }
  }
  if item.count > 1,
    let position = pointAttribute(kAXPositionAttribute as CFString, of: element),
    let size = sizeAttribute(kAXSizeAttribute as CFString, of: element)
  {
    item["frame"] = "\(Int(position.x)),\(Int(position.y)),\(Int(size.width)),\(Int(size.height))"
  }
  return item.count > 1 ? item : nil
}

private func inspect(currentLabel: String) throws {
  let (_, application) = try codexApplication()
  let window = try frontWindow(of: application)
  let controls = descendants(of: window).compactMap {
    safeDescription(
      of: $0,
      currentLabel: currentLabel,
      allowedRoles: Set(modelControlRoles)
    )
  }
  let output: [String: Any] = [
    "bundleIdentifier": codexBundleIdentifier,
    "controls": controls,
    "windowFound": true,
  ]
  let data = try JSONSerialization.data(
    withJSONObject: output, options: [.prettyPrinted, .sortedKeys])
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write(Data("\n".utf8))
}

private func inspectMenu(currentLabel: String) throws {
  let (_, application) = try codexApplication()
  let window = try frontWindow(of: application)
  let controls = exactMatches(
    in: descendants(of: window),
    roles: Set(modelControlRoles),
    label: currentLabel
  )
  guard !controls.isEmpty else { throw HelperError.controlMissing }
  guard controls.count == 1, let control = controls.first else {
    throw HelperError.controlAmbiguous
  }
  guard AXUIElementPerformAction(control, kAXShowMenuAction as CFString) == .success else {
    throw HelperError.pressFailed
  }
  defer { _ = AXUIElementPerformAction(control, kAXPressAction as CFString) }
  Thread.sleep(forTimeInterval: 0.25)

  let systemWide = AXUIElementCreateSystemWide()
  var roots = [application, window, control]
  if let focused = elementAttribute(kAXFocusedUIElementAttribute as CFString, of: systemWide) {
    roots.append(focused)
    var ancestor = focused
    for _ in 0..<12 {
      guard let parent = elementAttribute(kAXParentAttribute as CFString, of: ancestor) else {
        break
      }
      roots.append(parent)
      ancestor = parent
    }
  }
  let elements = unique(roots.flatMap { descendants(of: $0) })
  let matches = elements.compactMap {
    safeDescription(of: $0, currentLabel: currentLabel)
  }
  let output: [String: Any] = [
    "controlActions": actionNames(of: control),
    "elements": matches,
  ]
  let data = try JSONSerialization.data(
    withJSONObject: output, options: [.prettyPrinted, .sortedKeys])
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write(Data("\n".utf8))
}

private func inspectFocus(currentLabel: String) throws {
  let (_, application) = try codexApplication()
  let window = try frontWindow(of: application)
  let controls = exactMatches(
    in: descendants(of: window),
    roles: Set(modelControlRoles),
    label: currentLabel
  )
  guard !controls.isEmpty else { throw HelperError.controlMissing }
  guard controls.count == 1, let control = controls.first else {
    throw HelperError.controlAmbiguous
  }
  guard AXUIElementPerformAction(control, kAXPressAction as CFString) == .success else {
    throw HelperError.pressFailed
  }
  defer { _ = AXUIElementPerformAction(control, kAXPressAction as CFString) }
  Thread.sleep(forTimeInterval: 0.25)

  let systemWide = AXUIElementCreateSystemWide()
  var elements = [AXUIElement]()
  for source in [systemWide, application] {
    if let focused = elementAttribute(kAXFocusedUIElementAttribute as CFString, of: source) {
      elements.append(focused)
      var ancestor = focused
      for _ in 0..<12 {
        guard
          let parent = elementAttribute(
            kAXParentAttribute as CFString,
            of: ancestor
          )
        else { break }
        elements.append(parent)
        ancestor = parent
      }
    }
  }
  let focusedElements = unique(elements).compactMap { element -> [String: String]? in
    guard let role = stringAttribute(kAXRoleAttribute as CFString, of: element) else {
      return nil
    }
    var item = ["role": role]
    if let subrole = stringAttribute(kAXSubroleAttribute as CFString, of: element) {
      item["subrole"] = subrole
    }
    let safeAttributes: [(String, CFString)] = [
      ("name", kAXTitleAttribute as CFString),
      ("value", kAXValueAttribute as CFString),
      ("description", kAXDescriptionAttribute as CFString),
    ]
    for (key, attributeName) in safeAttributes {
      if let value = stringAttribute(attributeName, of: element),
        isSafeModelText(value, currentLabel: currentLabel)
      {
        item[key] = value
      }
    }
    return item
  }
  let output: [String: Any] = ["focusedElements": focusedElements]
  let data = try JSONSerialization.data(
    withJSONObject: output, options: [.prettyPrinted, .sortedKeys])
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write(Data("\n".utf8))
}

private func inspectTarget(currentLabel: String, targetLabel: String) throws {
  let (_, application) = try codexApplication()
  let window = try frontWindow(of: application)
  let controls = exactMatches(
    in: descendants(of: window),
    roles: Set(modelControlRoles),
    label: currentLabel
  )
  guard !controls.isEmpty else { throw HelperError.controlMissing }
  guard controls.count == 1, let control = controls.first else {
    throw HelperError.controlAmbiguous
  }
  guard AXUIElementPerformAction(control, kAXPressAction as CFString) == .success else {
    throw HelperError.pressFailed
  }
  defer { _ = AXUIElementPerformAction(control, kAXPressAction as CFString) }
  Thread.sleep(forTimeInterval: 0.2)
  let candidates = targetCandidatesAround(control: control, targetLabel: targetLabel)
  let output: [String: Any] = [
    "candidateCount": candidates.count
  ]
  let data = try JSONSerialization.data(
    withJSONObject: output, options: [.prettyPrinted, .sortedKeys])
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write(Data("\n".utf8))
}

private func run() throws {
  let arguments = Array(CommandLine.arguments.dropFirst())
  if arguments == ["inspect-capture-access"] {
    let output = ["screenCaptureAccess": CGPreflightScreenCaptureAccess()]
    let data = try JSONSerialization.data(
      withJSONObject: output,
      options: [.prettyPrinted, .sortedKeys]
    )
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
    return
  }
  if arguments.first == "inspect", arguments.count == 2,
    isModelSettingLabel(arguments[1])
  {
    try inspect(currentLabel: arguments[1])
    return
  }
  if arguments.first == "inspect-menu", arguments.count == 2,
    isModelSettingLabel(arguments[1])
  {
    try inspectMenu(currentLabel: arguments[1])
    return
  }
  if arguments.first == "inspect-focus", arguments.count == 2,
    isModelSettingLabel(arguments[1])
  {
    try inspectFocus(currentLabel: arguments[1])
    return
  }
  if arguments.first == "inspect-target", arguments.count == 3,
    isModelSettingLabel(arguments[1]), isModelSettingLabel(arguments[2])
  {
    try inspectTarget(currentLabel: arguments[1], targetLabel: arguments[2])
    return
  }
  guard arguments.count == 3, arguments[0] == "update",
    isModelSettingLabel(arguments[1]), isModelSettingLabel(arguments[2])
  else {
    throw HelperError.invalidArguments
  }
  try update(currentLabel: arguments[1], targetLabel: arguments[2])
}

do {
  try run()
} catch let error as HelperError {
  FileHandle.standardError.write(Data("\(errorPrefix)\(error.rawValue)\n".utf8))
  exit(EXIT_FAILURE)
} catch {
  FileHandle.standardError.write(Data("\(errorPrefix)unexpected\n".utf8))
  exit(EXIT_FAILURE)
}
