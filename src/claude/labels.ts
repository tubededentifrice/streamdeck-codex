// These functions are also injected into the JXA Claude action with
// Function.prototype.toString, so each one must stay self-contained.

/**
 * Converts a Claude effort label to its value. Only the first word counts,
 * because a picker item can add a note, such as "Medium Recommended" or
 * "Max 3.5× or more usage". Returns undefined for an empty label.
 */
export function claudeEffort(label: string): string | undefined {
  const efforts: Record<string, string> = {
    extra: "xhigh",
    high: "high",
    low: "low",
    max: "max",
    medium: "medium",
    minimal: "minimal",
    none: "none",
    xhigh: "xhigh",
  };
  const word = (label.trim().split(/\s+/)[0] || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  return word ? (efforts[word] ?? word) : undefined;
}

/**
 * Builds the label of a Claude model button, such as "Opus 5.5, High", from
 * its text parts ("Opus 5.5", " ", "High"). Without text parts, the label
 * comes from the button title, such as "Model: Opus 4.5". A model without an
 * effort choice shows no effort.
 */
export function claudeButtonLabel(
  title: string,
  texts: readonly string[],
): string | undefined {
  const parts = texts.map((text) => text.trim()).filter(Boolean);
  if (parts.length > 1)
    return `${parts.slice(0, -1).join(" ")}, ${parts[parts.length - 1]}`;
  if (parts.length === 1) return parts[0];
  const name = title.replace(/^Model:\s*/, "").trim();
  return name || undefined;
}

/**
 * Reads a model button label, such as "Opus 5.5, High" or "Opus 4.5". Convert
 * the effort label with claudeEffort.
 */
export function parseClaudeLabel(
  label: string,
): { effortLabel: string | undefined; model: string } | undefined {
  const separator = label.lastIndexOf(", ");
  const model = (separator < 0 ? label : label.slice(0, separator)).trim();
  if (!model) return undefined;
  const effortLabel =
    separator < 0 ? undefined : label.slice(separator + 2).trim() || undefined;
  return { effortLabel, model };
}

/**
 * Tells whether a picker item, such as "Opus 5.5" or "Opus 5.5 For complex
 * work and everyday tasks", names a model, such as "claude-opus-5-5". Whole
 * words must match, so "Opus 5" does not match "Opus 5.5".
 */
export function claudeModelMatches(title: string, model: string): boolean {
  const key = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .replace(/^claude-/, "");
  const target = key(model);
  if (!target) return false;
  const words = title.trim().split(/\s+/);
  for (let size = 1; size <= words.length; size += 1)
    if (key(words.slice(0, size).join(" ")) === target) return true;
  return false;
}

/** Converts a model button name, such as "Opus 5.5", to "claude-opus-5-5". */
export function claudeModelId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (!slug) return name;
  return slug.startsWith("claude-") ? slug : `claude-${slug}`;
}
