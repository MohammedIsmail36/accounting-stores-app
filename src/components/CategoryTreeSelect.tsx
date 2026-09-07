import React, { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import {
  ChevronsUpDown,
  ChevronLeft,
  Folder,
  FolderOpen,
  Check,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface CategoryItem {
  id: string;
  name: string;
  parent_id?: string | null;
}

interface TreeNode extends CategoryItem {
  children: TreeNode[];
}

interface CategoryTreeSelectProps {
  categories: CategoryItem[];
  value: string;
  onValueChange: (id: string) => void;
  placeholder?: string;
  className?: string;
}

function buildTree(items: CategoryItem[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  items.forEach((item) => map.set(item.id, { ...item, children: [] }));
  const roots: TreeNode[] = [];
  items.forEach((item) => {
    const node = map.get(item.id)!;
    if (item.parent_id && map.has(item.parent_id)) {
      map.get(item.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  });
  return roots;
}

function getFullPath(id: string, items: CategoryItem[]): string {
  const map = new Map(items.map((i) => [i.id, i]));
  const parts: string[] = [];
  let current = map.get(id);
  while (current) {
    parts.unshift(current.name);
    current = current.parent_id ? map.get(current.parent_id) : undefined;
  }
  return parts.join(" / ");
}

// Get all ancestor IDs for a given node
function getAncestorIds(id: string, items: CategoryItem[]): Set<string> {
  const map = new Map(items.map((i) => [i.id, i]));
  const ancestors = new Set<string>();
  let current = map.get(id);
  while (current?.parent_id) {
    ancestors.add(current.parent_id);
    current = map.get(current.parent_id);
  }
  return ancestors;
}

function TreeNodeItem({
  node,
  level,
  selectedId,
  onSelect,
  searchQuery,
  matchingIds,
}: {
  node: TreeNode;
  level: number;
  selectedId: string;
  onSelect: (id: string) => void;
  searchQuery: string;
  matchingIds: Set<string>;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children.length > 0;
  const isSelected = node.id === selectedId;
  const isMatch = matchingIds.has(node.id);

  // When searching, only show nodes that match or have matching descendants
  if (searchQuery && !isMatch) return null;

  return (
    <div>
      <button
        type="button"
        className={cn(
          "flex items-center gap-2 w-full text-right px-2 py-2 text-sm rounded-sm transition-colors",
          "hover:bg-accent hover:text-accent-foreground",
          isSelected && "bg-primary/10 text-primary font-medium",
        )}
        style={{ paddingRight: `${level * 16 + 8}px` }}
        onClick={() => onSelect(node.id)}
      >
        {hasChildren ? (
          <span
            className="shrink-0 cursor-pointer rounded p-0.5 hover:bg-muted"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
          >
            <ChevronLeft
              className={cn(
                "h-3.5 w-3.5 text-muted-foreground transition-transform duration-150",
                expanded && "-rotate-90",
              )}
            />
          </span>
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        {hasChildren ? (
          expanded ? (
            <FolderOpen className="h-3.5 w-3.5 text-primary/60 shrink-0" />
          ) : (
            <Folder className="h-3.5 w-3.5 text-primary/60 shrink-0" />
          )
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        <span className="flex-1 truncate">{node.name}</span>
        {isSelected && <Check className="h-4 w-4 text-primary shrink-0" />}
      </button>
      {hasChildren && (expanded || searchQuery) && (
        <div>
          {node.children.map((child) => (
            <TreeNodeItem
              key={child.id}
              node={child}
              level={level + 1}
              selectedId={selectedId}
              onSelect={onSelect}
              searchQuery={searchQuery}
              matchingIds={matchingIds}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function CategoryTreeSelect({
  categories,
  value,
  onValueChange,
  placeholder = "اختر التصنيف",
  className,
}: CategoryTreeSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const tree = useMemo(() => buildTree(categories), [categories]);
  const isAll = !value || value === "all";
  const displayText = isAll ? placeholder : getFullPath(value, categories);

  // Build set of matching IDs (direct matches + their ancestors so the tree path is visible)
  const matchingIds = useMemo(() => {
    if (!search.trim()) return new Set<string>();
    const query = search.trim().toLowerCase();
    const directMatches = categories.filter((c) =>
      c.name.toLowerCase().includes(query),
    );
    const ids = new Set<string>();
    directMatches.forEach((m) => {
      ids.add(m.id);
      const ancestors = getAncestorIds(m.id, categories);
      ancestors.forEach((a) => ids.add(a));
    });
    return ids;
  }, [search, categories]);

  const handleSelect = (id: string) => {
    onValueChange(id === value ? "all" : id);
    setOpen(false);
    setSearch("");
  };

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setSearch("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          className={cn(
            "justify-between font-normal text-sm shadow-xs transition-colors",
            "hover:bg-accent/50",
            isAll && "text-muted-foreground",
            open && "ring-2 ring-ring/20 border-ring",
            className,
          )}
        >
          <span className="truncate flex-1 text-right">{displayText}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-72 p-0 shadow-lg border-border/80"
        align="start"
        dir="rtl"
        sideOffset={5}
      >
        {/* Search Input */}
        <div className="p-2 border-b">
          <div className="relative">
            <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50" />
            <Input
              placeholder="ابحث عن تصنيف..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 text-sm pr-8 border-0 bg-muted/50 focus-visible:ring-1"
              autoFocus
            />
          </div>
        </div>
        <div className="p-1 max-h-64 overflow-y-auto">
          {/* All categories option */}
          {!search.trim() && (
            <button
              type="button"
              className={cn(
                "flex items-center gap-2 w-full text-right px-2 py-2 text-sm rounded-sm transition-colors",
                "hover:bg-accent hover:text-accent-foreground",
                isAll && "bg-primary/10 text-primary font-medium",
              )}
              onClick={() => {
                onValueChange("all");
                setOpen(false);
                setSearch("");
              }}
            >
              <span className="w-3.5 shrink-0" />
              <span className="w-3.5 shrink-0" />
              <span className="flex-1 truncate">{placeholder}</span>
              {isAll && <Check className="h-4 w-4 text-primary shrink-0" />}
            </button>
          )}
          {tree.length === 0 ? (
            <p className="text-sm text-muted-foreground/70 text-center py-6">
              لا توجد تصنيفات
            </p>
          ) : search.trim() && matchingIds.size === 0 ? (
            <p className="text-sm text-muted-foreground/70 text-center py-6">
              لا توجد نتائج
            </p>
          ) : (
            tree.map((node) => (
              <TreeNodeItem
                key={node.id}
                node={node}
                level={0}
                selectedId={value}
                onSelect={handleSelect}
                searchQuery={search.trim()}
                matchingIds={matchingIds}
              />
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
