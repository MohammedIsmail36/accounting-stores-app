import { supabase } from "@/integrations/supabase/client";

const BUCKET = "product-images";

/**
 * Extract storage object path from a Supabase public URL.
 * Returns null for non-matching URLs (external, empty, malformed).
 */
function extractStoragePath(publicUrl: string | null | undefined): string | null {
  if (!publicUrl) return null;
  const marker = `/storage/v1/object/public/${BUCKET}/`;
  const idx = publicUrl.indexOf(marker);
  if (idx === -1) return null;
  const path = publicUrl.slice(idx + marker.length).split("?")[0];
  return path || null;
}

/**
 * Best-effort delete of a single file from storage by public URL.
 * Silently ignores errors so caller flows are never blocked.
 */
export async function deleteStorageFile(publicUrl: string | null | undefined): Promise<void> {
  const path = extractStoragePath(publicUrl);
  if (!path) return;
  try {
    await supabase.storage.from(BUCKET).remove([path]);
  } catch {
    /* ignore */
  }
}

/**
 * Best-effort batch delete from storage by public URLs.
 */
export async function deleteStorageFiles(publicUrls: (string | null | undefined)[]): Promise<void> {
  const paths = publicUrls.map(extractStoragePath).filter((p): p is string => !!p);
  if (paths.length === 0) return;
  try {
    await supabase.storage.from(BUCKET).remove(paths);
  } catch {
    /* ignore */
  }
}
