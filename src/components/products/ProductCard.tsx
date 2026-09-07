import React from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Eye, Pencil, MoreVertical, Package, CheckCircle2, Archive, Trash2 } from "lucide-react";
import { TelegramPublishButton } from "./TelegramPublishButton";

export interface ProductCardData {
  id: string;
  code: string;
  name: string;
  model_number: string | null;
  main_image_url: string | null;
  purchase_price: number;
  selling_price: number;
  quantity_on_hand: number;
  min_stock_level: number;
  is_active: boolean;
  unit: string | null;
  product_categories?: { name: string } | null;
  product_units?: { name: string } | null;
  product_brands?: { name: string } | null;
}

interface ProductCardProps {
  product: ProductCardData;
  usageCount: number;
  canEdit: boolean;
  isAdmin: boolean;
  onView: () => void;
  onEdit: () => void;
  onToggleStatus: () => void;
  onDelete: () => void;
}

const fmtNum = (n: number) =>
  Number(n || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
const fmtInt = (n: number) => Number(n || 0).toLocaleString("en-US");

function StockBadge({ qty, min }: { qty: number; min: number }) {
  if (qty <= 0)
    return (
      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-destructive/90 text-destructive-foreground shadow-sm">
        نفذ
      </span>
    );
  if (qty < min)
    return (
      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/90 text-white shadow-sm">منخفض</span>
    );
  return (
    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/90 text-white shadow-sm">متوفر</span>
  );
}

export function ProductCard({
  product: p,
  usageCount,
  canEdit,
  isAdmin,
  onView,
  onEdit,
  onToggleStatus,
  onDelete,
}: ProductCardProps) {
  const [imgError, setImgError] = React.useState(false);
  const brand = p.product_brands?.name;
  const category = p.product_categories?.name;
  const unit = p.product_units?.name || p.unit || "";
  const canDelete = isAdmin && usageCount === 0 && Number(p.quantity_on_hand || 0) === 0;

  return (
    <Card
      className={`group relative overflow-hidden rounded-xl border transition-all hover:shadow-md hover:-translate-y-0.5 cursor-pointer ${
        !p.is_active ? "opacity-70" : ""
      }`}
      onClick={onView}
    >
      {/* Image */}
      <div className="relative aspect-[4/3] bg-muted overflow-hidden">
        {p.main_image_url && !imgError ? (
          <img
            src={p.main_image_url}
            alt={p.name}
            loading="lazy"
            onError={() => setImgError(true)}
            className="w-full h-full object-cover transition-transform group-hover:scale-105"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground/40">
            <Package className="h-12 w-12" />
          </div>
        )}

        {/* Top badges */}
        <div className="absolute top-2 right-2 flex flex-col gap-1 items-end">
          <StockBadge qty={p.quantity_on_hand} min={p.min_stock_level} />
          {!p.is_active && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-muted-foreground/80 text-background">
              غير نشط
            </span>
          )}
        </div>

        {/* Actions menu */}
        <div className="absolute top-2 left-2 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <div className="rounded-full bg-background/90 shadow-sm">
            <TelegramPublishButton
              product={{
                id: p.id,
                name: p.name,
                code: p.code,
                main_image_url: p.main_image_url,
                quantity_on_hand: p.quantity_on_hand,
                is_active: p.is_active,
              }}
            />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="secondary"
                size="icon"
                className="h-7 w-7 rounded-full shadow-sm bg-background/90 hover:bg-background"
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-44">
              <DropdownMenuItem onClick={onView}>
                <Eye className="h-4 w-4 ml-2" />
                عرض
              </DropdownMenuItem>
              {canEdit && (
                <DropdownMenuItem onClick={onEdit}>
                  <Pencil className="h-4 w-4 ml-2" />
                  تعديل
                </DropdownMenuItem>
              )}
              {canEdit && (
                <DropdownMenuItem onClick={onToggleStatus}>
                  {p.is_active ? (
                    <>
                      <Archive className="h-4 w-4 ml-2" />
                      تعطيل
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-4 w-4 ml-2" />
                      تفعيل
                    </>
                  )}
                </DropdownMenuItem>
              )}
              {canDelete && (
                <>
                  <DropdownMenuSeparator />
                  <ConfirmDialog
                    title="حذف المنتج نهائياً؟"
                    description={`سيتم حذف المنتج "${p.name}" بشكل نهائي. لا يمكن التراجع.`}
                    confirmText="حذف"
                    destructive
                    onConfirm={onDelete}
                    trigger={
                      <DropdownMenuItem
                        onSelect={(e) => e.preventDefault()}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="h-4 w-4 ml-2" />
                        حذف نهائي
                      </DropdownMenuItem>
                    }
                  />

                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Body */}
      <div className="p-3 space-y-1.5">
        <h3 className="font-bold text-sm text-foreground truncate" title={p.name}>
          {p.name}
        </h3>
        <p className="text-[0.9rem] text-muted-foreground truncate min-h-[14px]">
          {[brand, p.model_number].filter(Boolean).join(" - ") || "—"}
        </p>
        <p className="text-[10px] text-muted-foreground/80 truncate font-mono">
          {p.code}
          {category ? ` · ${category}` : ""}
        </p>

        <div className="flex items-end justify-between pt-2 border-t mt-2">
          <div className="flex flex-col">
            <span className="text-[9px] text-muted-foreground uppercase tracking-wide">الكمية</span>
            <span className="text-xs font-bold text-foreground">
              {fmtInt(p.quantity_on_hand)} {unit}
            </span>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-[9px] text-muted-foreground uppercase tracking-wide">البيع</span>
            <span className="text-sm font-black text-primary font-mono leading-tight">{fmtNum(p.selling_price)}</span>
            <span className="text-[10px] text-muted-foreground font-mono">شراء: {fmtNum(p.purchase_price)}</span>
          </div>
        </div>
      </div>
    </Card>
  );
}
