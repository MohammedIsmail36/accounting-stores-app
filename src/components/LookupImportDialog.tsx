import React, { useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Upload, Download, FileSpreadsheet, Loader2, CheckCircle2, AlertCircle, RefreshCw } from "lucide-react";
import { readExcelFile, exportToExcel } from "@/lib/excel-export";
import { notify } from "@/lib/notify";

type LookupType = "categories" | "brands" | "units";

interface LookupImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: LookupType;
  onImportComplete: () => void;
}

interface LookupConfig {
  table: string;
  title: string;
  headers: string[];
  templateRows: (string | number)[][];
  parentSupport: boolean;
  // Map row -> payload (excluding name); row is 1-indexed (ExcelJS)
  buildPayload: (row: any[]) => Record<string, any>;
}

const CONFIG: Record<LookupType, LookupConfig> = {
  categories: {
    table: "product_categories",
    title: "التصنيفات",
    headers: ["الاسم", "الوصف", "التصنيف الأب"],
    templateRows: [
      ["إلكترونيات", "أجهزة إلكترونية", ""],
      ["هواتف", "هواتف ذكية", "إلكترونيات"],
    ],
    parentSupport: true,
    buildPayload: (row) => ({
      description: String(row[2] || "").trim() || null,
    }),
  },
  brands: {
    table: "product_brands",
    title: "الماركات",
    headers: ["الاسم", "بلد المنشأ"],
    templateRows: [
      ["سامسونج", "كوريا الجنوبية"],
      ["أبل", "الولايات المتحدة"],
    ],
    parentSupport: false,
    buildPayload: (row) => ({
      country: String(row[2] || "").trim() || null,
    }),
  },
  units: {
    table: "product_units",
    title: "وحدات القياس",
    headers: ["الاسم", "الرمز"],
    templateRows: [
      ["قطعة", "قطعة"],
      ["كيلوجرام", "كجم"],
      ["متر", "م"],
    ],
    parentSupport: false,
    buildPayload: (row) => ({
      symbol: String(row[2] || "").trim() || null,
    }),
  },
};

export function LookupImportDialog({ open, onOpenChange, type, onImportComplete }: LookupImportDialogProps) {
  const config = CONFIG[type];
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState<{ added: number; updated: number; errors: string[] } | null>(null);

  const downloadTemplate = async () => {
    await exportToExcel({
      filename: `قالب_${config.title}`,
      sheetName: config.title,
      headers: config.headers,
      rows: config.templateRows,
    });
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setResults(null);

    try {
      const { rows } = await readExcelFile(file);
      if (rows.length < 2) {
        notify.error("خطأ", "الملف فارغ أو لا يحتوي على بيانات");
        setImporting(false);
        return;
      }

      // ExcelJS row.values is 1-indexed (index 0 is undefined)
      const dataRows = rows.slice(1).filter((r) => r && r[1]);
      let added = 0;
      let updated = 0;
      const errors: string[] = [];

      // Pre-fetch existing rows by lowercase name for upsert
      const { data: existing } = await (supabase.from(config.table as any) as any).select("id, name");
      const nameToId = new Map<string, string>();
      const lowerToId = new Map<string, string>();
      (existing || []).forEach((c: any) => {
        nameToId.set(c.name, c.id);
        lowerToId.set(String(c.name).trim().toLowerCase(), c.id);
      });

      if (type === "categories" && config.parentSupport) {
        for (const row of dataRows) {
          const name = String(row[1] || "").trim();
          const description = String(row[2] || "").trim() || null;
          const parentName = String(row[3] || "").trim();

          if (!name) continue;

          // Resolve / create parent first
          let parent_id: string | null = null;
          if (parentName) {
            parent_id = lowerToId.get(parentName.toLowerCase()) || null;
            if (!parent_id) {
              const { data: parentData, error: parentErr } = await (supabase.from("product_categories") as any)
                .insert({ name: parentName }).select("id").single();
              if (parentErr) {
                errors.push(`خطأ في إنشاء التصنيف الأب "${parentName}": ${parentErr.message}`);
                continue;
              }
              parent_id = parentData.id;
              nameToId.set(parentName, parent_id);
              lowerToId.set(parentName.toLowerCase(), parent_id);
            }
          }

          const existingId = lowerToId.get(name.toLowerCase());
          if (existingId) {
            const { error } = await (supabase.from("product_categories") as any)
              .update({ description, parent_id })
              .eq("id", existingId);
            if (error) errors.push(`فشل تحديث "${name}": ${error.message}`);
            else updated++;
          } else {
            const { data: inserted, error } = await (supabase.from("product_categories") as any)
              .insert({ name, description, parent_id }).select("id").single();
            if (error) errors.push(`فشل إضافة "${name}": ${error.message}`);
            else {
              nameToId.set(name, inserted.id);
              lowerToId.set(name.toLowerCase(), inserted.id);
              added++;
            }
          }
        }
      } else {
        // Brands & Units — simple upsert by name
        for (const row of dataRows) {
          const name = String(row[1] || "").trim();
          if (!name) continue;
          const payload = config.buildPayload(row);
          const existingId = lowerToId.get(name.toLowerCase());

          if (existingId) {
            const { error } = await (supabase.from(config.table as any) as any)
              .update(payload)
              .eq("id", existingId);
            if (error) errors.push(`فشل تحديث "${name}": ${error.message}`);
            else updated++;
          } else {
            const { error } = await (supabase.from(config.table as any) as any)
              .insert({ name, ...payload });
            if (error) errors.push(`فشل إضافة "${name}": ${error.message}`);
            else added++;
          }
        }
      }

      setResults({ added, updated, errors });
      const total = added + updated;
      if (total > 0) {
        const parts: string[] = [];
        if (added > 0) parts.push(`أُضيف ${added}`);
        if (updated > 0) parts.push(`تم تحديث ${updated}`);
        notify.success("تم الاستيراد", parts.join(" • "));
        onImportComplete();
      }
    } catch (err: any) {
      notify.error("خطأ", err.message);
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            استيراد {config.title} من Excel
          </DialogTitle>
          <DialogDescription>
            قم بتحميل القالب وتعبئته ثم ارفع الملف. يتم تحديث العنصر الموجود تلقائياً عند تطابق الاسم.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Button variant="outline" className="w-full gap-2" onClick={downloadTemplate}>
            <Download className="h-4 w-4" />
            تحميل قالب Excel
          </Button>

          <div className="relative">
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileSelect}
              className="absolute inset-0 opacity-0 cursor-pointer"
              disabled={importing}
            />
            <Button variant="secondary" className="w-full gap-2" disabled={importing}>
              {importing ? (
                <><Loader2 className="h-4 w-4 animate-spin" />جارٍ الاستيراد...</>
              ) : (
                <><Upload className="h-4 w-4" />رفع ملف Excel</>
              )}
            </Button>
          </div>

          {results && (
            <div className="rounded-lg border bg-muted/50 p-3 space-y-2 max-h-64 overflow-auto">
              {results.added > 0 && (
                <div className="flex items-center gap-2 text-sm text-green-600">
                  <CheckCircle2 className="h-4 w-4" />
                  أُضيف {results.added} عنصر جديد
                </div>
              )}
              {results.updated > 0 && (
                <div className="flex items-center gap-2 text-sm text-blue-600">
                  <RefreshCw className="h-4 w-4" />
                  تم تحديث {results.updated} عنصر موجود
                </div>
              )}
              {results.errors.map((err, i) => (
                <div key={i} className="flex items-center gap-2 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{err}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>إغلاق</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
