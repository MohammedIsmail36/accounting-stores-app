import { describe, it, expect } from "vitest";
import {
  buildCategoryTree,
  getDescendantIds,
  flattenCategoryTree,
  CategoryNode,
} from "./category-utils";

const makeCat = (
  id: string,
  name: string,
  parent_id: string | null = null,
  is_active = true,
) => ({ id, name, parent_id, is_active });

describe("buildCategoryTree", () => {
  it("returns empty tree for empty array", () => {
    expect(buildCategoryTree([])).toEqual([]);
  });

  it("flat categories (no parents) become root nodes", () => {
    const flat = [makeCat("1", "A"), makeCat("2", "B")];
    const tree = buildCategoryTree(flat);
    expect(tree).toHaveLength(2);
    expect(tree[0].children).toEqual([]);
    expect(tree[1].children).toEqual([]);
  });

  it("builds correct parent-child relationships", () => {
    const flat = [makeCat("1", "Parent"), makeCat("2", "Child", "1")];
    const tree = buildCategoryTree(flat);
    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe("1");
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].id).toBe("2");
  });

  it("handles multiple levels of nesting", () => {
    const flat = [
      makeCat("1", "Root"),
      makeCat("2", "Child", "1"),
      makeCat("3", "Grandchild", "2"),
    ];
    const tree = buildCategoryTree(flat);
    expect(tree).toHaveLength(1);
    expect(tree[0].children[0].children[0].id).toBe("3");
  });

  it("treats orphaned children (missing parent) as roots", () => {
    const flat = [makeCat("1", "Root"), makeCat("2", "Orphan", "999")];
    const tree = buildCategoryTree(flat);
    expect(tree).toHaveLength(2);
    const ids = tree.map((n) => n.id);
    expect(ids).toContain("1");
    expect(ids).toContain("2");
  });

  it("handles multiple roots with children each", () => {
    const flat = [
      makeCat("1", "Root A"),
      makeCat("2", "Root B"),
      makeCat("3", "Child A1", "1"),
      makeCat("4", "Child B1", "2"),
    ];
    const tree = buildCategoryTree(flat);
    expect(tree).toHaveLength(2);
    expect(tree[0].children).toHaveLength(1);
    expect(tree[1].children).toHaveLength(1);
  });
});

describe("getDescendantIds", () => {
  const tree: CategoryNode[] = buildCategoryTree([
    makeCat("1", "Root"),
    makeCat("2", "Child A", "1"),
    makeCat("3", "Child B", "1"),
    makeCat("4", "Grandchild", "2"),
  ]);

  it("returns empty array for leaf node not in tree", () => {
    expect(getDescendantIds(tree, "nonexistent")).toEqual([]);
  });

  it("returns only itself for a leaf node", () => {
    const ids = getDescendantIds(tree, "4");
    expect(ids).toEqual(["4"]);
  });

  it("returns all descendants for root with children", () => {
    const ids = getDescendantIds(tree, "1");
    expect(ids).toEqual(expect.arrayContaining(["1", "2", "3", "4"]));
    expect(ids).toHaveLength(4);
  });

  it("returns subtree for an intermediate node", () => {
    const ids = getDescendantIds(tree, "2");
    expect(ids).toEqual(expect.arrayContaining(["2", "4"]));
    expect(ids).toHaveLength(2);
  });

  it("handles deep nesting", () => {
    const deep = buildCategoryTree([
      makeCat("a", "L1"),
      makeCat("b", "L2", "a"),
      makeCat("c", "L3", "b"),
      makeCat("d", "L4", "c"),
    ]);
    const ids = getDescendantIds(deep, "a");
    expect(ids).toHaveLength(4);
  });
});

describe("flattenCategoryTree", () => {
  it("returns empty array for empty tree", () => {
    expect(flattenCategoryTree([])).toEqual([]);
  });

  it("flattens a nested tree preserving all nodes", () => {
    const flat = [
      makeCat("1", "Root"),
      makeCat("2", "Child A", "1"),
      makeCat("3", "Child B", "1"),
      makeCat("4", "Grandchild", "2"),
    ];
    const tree = buildCategoryTree(flat);
    const flattened = flattenCategoryTree(tree);
    expect(flattened).toHaveLength(4);
    const ids = flattened.map((n) => n.id);
    expect(ids).toContain("1");
    expect(ids).toContain("2");
    expect(ids).toContain("3");
    expect(ids).toContain("4");
  });

  it("is inverse of buildCategoryTree (preserves count)", () => {
    const input = [
      makeCat("1", "A"),
      makeCat("2", "B", "1"),
      makeCat("3", "C"),
      makeCat("4", "D", "3"),
      makeCat("5", "E", "2"),
    ];
    const tree = buildCategoryTree(input);
    const flattened = flattenCategoryTree(tree);
    expect(flattened).toHaveLength(input.length);
  });

  it("returns depth-first order", () => {
    const flat = [
      makeCat("1", "Root"),
      makeCat("2", "Child", "1"),
      makeCat("3", "Grandchild", "2"),
    ];
    const tree = buildCategoryTree(flat);
    const flattened = flattenCategoryTree(tree);
    expect(flattened.map((n) => n.id)).toEqual(["1", "2", "3"]);
  });
});
