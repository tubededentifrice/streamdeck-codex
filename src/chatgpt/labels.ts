// These functions are also injected into the JXA ChatGPT action with
// Function.prototype.toString, so each one must stay self-contained.

/**
 * Reads a model and thinking label, such as "GPT-6.2 Sol High" or
 * "GPT-6.2 Sol Extra High". The thinking label is the last one or two words.
 * The model button uses the Codex labels, such as "Light" for low. The power
 * slider uses "Standard" for medium and "Extended" for high.
 */
export function parseChatGPTLabel(
  label: string,
): { effort: string | undefined; model: string } | undefined {
  const efforts: Record<string, string> = {
    extended: "high",
    "extra-high": "xhigh",
    high: "high",
    light: "low",
    low: "low",
    max: "max",
    medium: "medium",
    minimal: "minimal",
    none: "none",
    persistent: "persistent",
    standard: "medium",
    ultra: "ultra",
    xhigh: "xhigh",
  };
  const words = label.trim().split(/\s+/).filter(Boolean);
  for (const size of [2, 1]) {
    if (words.length <= size) continue;
    const key = words
      .slice(-size)
      .join("-")
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "");
    const effort = efforts[key];
    if (effort !== undefined)
      return { effort, model: words.slice(0, -size).join(" ") };
  }
  return words.length > 0
    ? { effort: undefined, model: words.join(" ") }
    : undefined;
}

/**
 * Reads a power slider announcement, such as "GPT-6.2 Sol Extended, 3 of 4."
 * or "GPT-6.2 Sol Extra High, 4 of 4. Consumes usage faster".
 */
export function parsePowerAnnouncement(
  text: string,
): { label: string; position: number; total: number } | undefined {
  const match = /^(.+), (\d+) of (\d+)\./.exec(text.trim());
  return match
    ? { label: match[1], position: Number(match[2]), total: Number(match[3]) }
    : undefined;
}
