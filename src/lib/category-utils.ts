export interface CategoryNode {
  id: string;
  name: string;
  parent_id: string | null;
  is_active: boolean;
  children: CategoryNode[];
}

/**
 * Build a tree from a flat list of categories.
 * Categories whose parent is missing from the list are treated as roots.
 */
export function buildCategoryTree(
  flat: {
    id: string;
    name: string;
    parent_id: string | null;
    is_active: boolean;
  }[],
): CategoryNode[] {
  const map = new Map<string, CategoryNode>();
  flat.forEach((c) => map.set(c.id, { ...c, children: [] }));
  const roots: CategoryNode[] = [];
  map.forEach((node) => {
    if (node.parent_id && map.has(node.parent_id)) {
      map.get(node.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  });
  return roots;
}

/**
 * Collect all descendant IDs (including the target itself) from a tree.
 */
export function getDescendantIds(
  tree: CategoryNode[],
  targetId: string,
): string[] {
  const ids: string[] = [];
  function collect(nodes: CategoryNode[]): boolean {
    for (const n of nodes) {
      if (n.id === targetId) {
        collectAll(n);
        return true;
      }
      if (collect(n.children)) return true;
    }
    return false;
  }
  function collectAll(node: CategoryNode) {
    ids.push(node.id);
    node.children.forEach(collectAll);
  }
  collect(tree);
  return ids;
}

/**
 * Count all descendants of a node (not including the node itself).
 */
export function countDescendants(node: CategoryNode): number {
  return node.children.reduce(
    (sum, child) => sum + 1 + countDescendants(child),
    0,
  );
}

/**
 * Build a full path string like "Electronics / Phones / Smartphones".
 */
export function getFullPath(
  items: { id: string; name: string; parent_id: string | null }[],
  id: string,
): string {
  const map = new Map(items.map((i) => [i.id, i]));
  const parts: string[] = [];
  let current = map.get(id);
  while (current) {
    parts.unshift(current.name);
    current = current.parent_id ? map.get(current.parent_id) : undefined;
  }
  return parts.join(" / ");
}

/**
 * Flatten a category tree back into a flat array (depth-first).
 */
export function flattenCategoryTree(tree: CategoryNode[]): CategoryNode[] {
  const result: CategoryNode[] = [];
  function walk(nodes: CategoryNode[]) {
    for (const node of nodes) {
      result.push(node);
      walk(node.children);
    }
  }
  walk(tree);
  return result;
}

/**
 * Check whether setting `newParentId` as the parent of `categoryId`
 * would create a cycle in the category hierarchy.
 * Follows the parent chain from `newParentId` upward; if it ever
 * reaches `categoryId`, a cycle would be formed.
 */
export function wouldCreateCycle(
  categoryId: string,
  newParentId: string | null,
  categories: { id: string; parent_id: string | null }[],
): boolean {
  if (!newParentId) return false;
  const map = new Map(categories.map((c) => [c.id, c.parent_id]));
  let current: string | null = newParentId;
  const visited = new Set<string>();
  while (current) {
    if (current === categoryId) return true;
    if (visited.has(current)) return false; // broken chain / existing cycle guard
    visited.add(current);
    current = map.get(current) ?? null;
  }
  return false;
}
