// These functions are also injected into the JXA composer action with
// Function.prototype.toString, so each one must stay self-contained.

/** Compares model names: "GPT-6.2-Sol" and "gpt-6.2-sol" give "gpt-6-2-sol". */
export function normalizeLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Converts a T3 Code thinking label, such as "Extra High", to its value. */
export function effortFromLabel(label: string): string {
  const value = label
    .replace(/\s+default$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const aliases: Record<string, string> = {
    "extra-high": "xhigh",
    "x-high": "xhigh",
  };
  return aliases[value] ?? value;
}

/** Reads the model button: "GPT-6.2-Sol, High · Standard". */
export function parseComposerLabel(
  description: string,
): { effortLabel: string | undefined; model: string } | undefined {
  const main = description.split(" · ")[0].trim();
  const separator = main.indexOf(", ");
  const model = (separator < 0 ? main : main.slice(0, separator)).trim();
  if (!model) return undefined;
  const effortLabel =
    separator < 0 ? undefined : main.slice(separator + 2).trim() || undefined;
  return { effortLabel, model };
}
