const INTERNAL_ORIGIN = "https://internal.invalid";
const ENCODED_PATH_SEPARATOR = /%(?:25)*(?:2f|5c)/i;

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 31 || code === 127) return true;
  }

  return false;
}

function isUnsafeCandidate(value: string): boolean {
  return (
    value.includes("\\") ||
    value.startsWith("//") ||
    hasControlCharacters(value) ||
    ENCODED_PATH_SEPARATOR.test(value)
  );
}

function hasUnsafePathSeparators(value: string): boolean {
  let decoded = value;

  // Inspect a small number of decoding layers so a nested query parameter
  // cannot hide a protocol-relative path or a backslash from this check.
  for (let depth = 0; depth < 3; depth += 1) {
    if (isUnsafeCandidate(decoded)) return true;

    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      return true;
    }
  }

  return isUnsafeCandidate(decoded);
}

/**
 * Returns a normalized same-origin route, or the fallback for unsafe input.
 * This must be used before passing a query-string redirect to React Router.
 */
export function getSafeInternalPath(
  value: string | null | undefined,
  fallback = "/",
): string {
  if (!value || !value.startsWith("/") || hasUnsafePathSeparators(value)) {
    return fallback;
  }

  try {
    const parsed = new URL(value, INTERNAL_ORIGIN);
    if (parsed.origin !== INTERNAL_ORIGIN) return fallback;

    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}
