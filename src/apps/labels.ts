// This function is also injected into the JXA programs with
// Function.prototype.toString, so it must stay self-contained.

/** Compares model names: "GPT-6.2-Sol" and "gpt-6.2-sol" give "gpt-6-2-sol". */
export function normalizeLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
