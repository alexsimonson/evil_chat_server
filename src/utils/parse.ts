export function parseBool(value: unknown, defaultValue = false): boolean {
  if (value === undefined || value === null || value === "") return defaultValue;

  // Express can sometimes give arrays for repeated query params (?x=1&x=2)
  if (Array.isArray(value)) return parseBool(value[0], defaultValue);

  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;

  const v = String(value).trim().toLowerCase();

  if (["1", "true", "t", "yes", "y", "on"].includes(v)) return true;
  if (["0", "false", "f", "no", "n", "off"].includes(v)) return false;

  return defaultValue;
}

export function parseIntStrict(value: unknown): number {
  if (value === undefined || value === null || value === "") {
    throw new Error("Expected an integer, got empty value");
  }

  if (Array.isArray(value)) return parseIntStrict(value[0]);

  // If already a number, validate it
  if (typeof value === "number") {
    if (!Number.isInteger(value)) throw new Error(`Invalid integer: ${value}`);
    return value;
  }

  const s = String(value).trim();

  // Avoid "12abc" => 12 behavior; require full integer string
  if (!/^-?\d+$/.test(s)) throw new Error(`Invalid integer: ${value}`);

  const n = Number(s);
  if (!Number.isSafeInteger(n)) throw new Error(`Integer out of range: ${value}`);

  return n;
}
