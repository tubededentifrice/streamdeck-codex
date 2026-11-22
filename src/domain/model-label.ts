const VENDORS = new Set(["anthropic", "chatgpt", "claude", "gpt", "openai"]);

function titleCase(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/**
 * Builds a short label from a model id, with the family words first and the
 * version last: "gpt-6.2-sol" is "Sol 6.2", "claude-opus-5-5" is "Opus 5.5",
 * and "glm-5-3" is "Glm 5.3". A vendor word stays only when no other word is
 * left, and a release date is removed.
 */
export function modelLabel(model: string): string {
  const id = (model.trim().split("/").pop() ?? "")
    .replace(/[-_ ]\d{4}-\d{2}-\d{2}$/, "")
    .replace(/[-_ ]\d{8}$/, "");
  const tokens = id.split(/[\s_-]+/).filter(Boolean);
  const words: string[] = [];
  const versions: string[][] = [];
  let previousNumeric = false;
  for (const token of tokens) {
    if (/^\d+(\.\d+)*$/.test(token)) {
      if (previousNumeric) versions[versions.length - 1].push(token);
      else versions.push([token]);
      previousNumeric = true;
      continue;
    }
    previousNumeric = false;
    words.push(token);
  }
  const named = words.filter((word) => !VENDORS.has(word.toLowerCase()));
  const label = [
    ...(named.length > 0 ? named : words).map(titleCase),
    ...versions.map((parts) => parts.join(".")),
  ].join(" ");
  return label || model.trim();
}
