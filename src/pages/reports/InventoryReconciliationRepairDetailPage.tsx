import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, ArrowRight, ClipboardCheck, FileClock, Info, Layers3, Pencil } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { ApproveInventoryRepairDialog } from "@/components/inventory-reconciliation/ApproveInventoryRepairDialog";
import { EditInventoryRepairDraftDialog } from "@/components/inventory-reconciliation/EditInventoryRepairDraftDialog";
import { SubmitInventoryRepairDraftDialog } from "@/components/inventory-reconciliation/SubmitInventoryRepairDraftDialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSettings } from "@/contexts/SettingsContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { formatDate, formatDateTime, formatNumber } from "@/lib/format";
import {
  getInventoryRepairItemPath,
  inventoryRepairAxisLabel,
  inventoryRepairActorLabel,
  inventoryRepairClassificationLabel,
  inventoryRepairEventLabel,
  inventoryRepairItemLabel,
  inventoryRepairNumber,
  inventoryRepairStatusClass,
  inventoryRepairStatusLabel,
  inventoryRepairTypeLabel,
  parseInventoryRepairDetail,
  parseInventoryRepairEffect,
  parseInventoryRepairEvent,
  parseInventoryRepairItem,
  type InventoryRepairEffect,
  type InventoryRepairEvent,
  type InventoryRepairItem,
  type InventoryRepairActor,
} from "@/lib/inventory-reconciliation-repair";
import { isUUID } from "@/lib/route-labels";

const shortId = (value: string) => `${value.slice(0, 8)}…`;

export default function InventoryReconciliationRepairDetailPage() {
  const { id = "" } = useParams();
  const { formatCurrency } = useSettings();
  const { user, fullName, role } = useAuth();
  const [editOpen, setEditOpen] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["inventory-reconciliation-repair", id],
    enabled: isUUID(id),
    queryFn: async () => {
      const [headerResult, itemsResult, effectsResult, eventsResult] = await Promise.all([
        supabase.from("inventory_reconciliation_repairs" as never)
          .select("*")
          .eq("id", id)
          .maybeSingle(),
        supabase.from("inventory_reconciliation_repair_items" as never)
          .select("*")
          .eq("repair_id", id)
          .order("line_number"),
        supabase.from("inventory_reconciliation_repair_effects" as never)
          .select("id, repair_item_id, effect_type, table_name, record_id, created_at")
          .eq("repair_id", id)
          .order("created_at"),
        supabase.from("inventory_reconciliation_repair_events" as never)
          .select("id, event_type, from_status, to_status, actor_id, created_at")
          .eq("repair_id", id)
          .order("created_at"),
      ]);

      for (const result of [headerResult, itemsResult, effectsResult, eventsResult]) {
        if (result.error) throw result.error;
      }
      if (!headerResult.data) return null;

      const events = (eventsResult.data ?? []).map(parseInventoryRepairEvent);
      const actorIds = [...new Set(events.map((event) => event.actorId))];
      const actors: Record<string, InventoryRepairActor> = {};
      if (actorIds.length > 0) {
        const [profilesResult, rolesResult] = await Promise.all([
          supabase.from("profiles").select("id, full_name").in("id", actorIds),
          supabase.from("user_roles").select("user_id, role").in("user_id", actorIds),
        ]);
        const profileMap = new Map((profilesResult.data ?? []).map((profile) => [profile.id, profile.full_name]));
        const roleMap = new Map((rolesResult.data ?? []).map((actorRole) => [actorRole.user_id, actorRole.role]));
        for (const actorId of actorIds) {
          actors[actorId] = {
            fullName: profileMap.get(actorId) ?? null,
            role: roleMap.get(actorId) ?? null,
          };
        }
      }

      return {
        repair: parseInventoryRepairDetail(headerResult.data),
        items: (itemsResult.data ?? []).map(parseInventoryRepairItem),
        effects: (effectsResult.data ?? []).map(parseInventoryRepairEffect),
        events,
        actors,
      };
    },
  });

  if (!isUUID(id)) return <NotFoundState />;
  if (isLoading) return <DetailSkeleton />;
  if (error) {
    return (
      <Alert variant="destructive" dir="rtl">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>تعذر تحميل المعالجة</AlertTitle>
        <AlertDescription>تعذر قراءة بيانات المعالجة. حاول مرة أخرى أو ارجع إلى السجل.</AlertDescription>
      </Alert>
    );
  }
  if (!data) return <NotFoundState />;

  const { repair, items, effects, events } = data;
  const actors = { ...data.actors };
  if (user) {
    actors[user.id] = {
      fullName: fullName || actors[user.id]?.fullName || null,
      role: role || actors[user.id]?.role || null,
    };
  }
  return (
    <div className="space-y-5" dir="rtl">
      <PageHeader
        icon={ClipboardCheck}
        title={`${inventoryRepairNumber(repair.repairNumber)} — ${repair.title}`}
        description="تفاصيل تشخيصية وتدقيقية للمعالجة دون تنفيذ أي أثر محاسبي أو مخزني"
        badge={(
          <Badge variant="outline" className={inventoryRepairStatusClass[repair.status]}>
            {inventoryRepairStatusLabel[repair.status]}
          </Badge>
        )}
        actions={(
          <>
            {repair.status === "draft" && (
              <>
                <SubmitInventoryRepairDraftDialog repair={repair} itemsCount={items.length} />
                <Button variant="outline" onClick={() => setEditOpen(true)}>
                  <Pencil className="ml-2 h-4 w-4" />
                  تعديل المسودة
                </Button>
              </>
            )}
            {repair.status === "ready_for_review" && role === "admin" && user && (
              <ApproveInventoryRepairDialog repair={repair} currentUserId={user.id} />
            )}
            <Button asChild variant="outline">
              <Link to="/reports/inventory-reconciliation/repairs">
                <ArrowRight className="ml-2 h-4 w-4" />
                العودة إلى السجل
              </Link>
            </Button>
          </>
        )}
      />

      <EditInventoryRepairDraftDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        repair={repair}
        items={items}
      />

      <Alert className="border-amber-200 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/20">
        <Info className="h-4 w-4 text-amber-700" />
        <AlertTitle>العرض والمراجعة فقط</AlertTitle>
        <AlertDescription>منفذ الإصلاح الفعلي غير مفعّل في 2B؛ لا تغيّر هذه الشاشة المنتجات أو الحركات أو القيود.</AlertDescription>
      </Alert>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard label="الحالة" value={inventoryRepairStatusLabel[repair.status]} />
        <SummaryCard label="الإصدار" value={String(repair.version)} />
        <SummaryCard label="تاريخ الإعداد" value={formatDateTime(repair.preparedAt)} />
        <SummaryCard label="التاريخ المحاسبي" value={formatDate(repair.accountingDate)} />
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">سبب المعالجة</CardTitle></CardHeader>
        <CardContent>
          <p className="whitespace-pre-wrap text-sm leading-7">{repair.explanation}</p>
          <div className="mt-3 text-xs text-muted-foreground">
            لقطة التشخيص: {formatDateTime(repair.diagnosticSnapshotAt)} • البصمة: <span className="font-mono" dir="ltr">{shortId(repair.diagnosticFingerprint)}</span>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="items" dir="rtl">
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="items">البنود ({items.length})</TabsTrigger>
          <TabsTrigger value="events">سجل الأحداث ({events.length})</TabsTrigger>
          <TabsTrigger value="effects">آثار التنفيذ ({effects.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="items" className="mt-3">
          <ItemsTable items={items} formatCurrency={formatCurrency} />
        </TabsContent>
        <TabsContent value="events" className="mt-3">
          <EventsList events={events} actors={actors} />
        </TabsContent>
        <TabsContent value="effects" className="mt-3">
          <EffectsTable effects={effects} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="mt-1 font-semibold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}

function ItemsTable({ items, formatCurrency }: { items: InventoryRepairItem[]; formatCurrency: (value: number) => string }) {
  if (items.length === 0) return <EmptyState title="لا توجد بنود" compact />;
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader><TableRow>
          <TableHead className="w-14">#</TableHead><TableHead>السجل المتأثر</TableHead><TableHead>التشخيص</TableHead>
          <TableHead>المعالجة المقترحة</TableHead><TableHead>قبل المعالجة</TableHead><TableHead>المقترح</TableHead>
        </TableRow></TableHeader>
        <TableBody>{items.map((item) => {
          const path = getInventoryRepairItemPath(item);
          const before = item.axis === "product"
            ? `البطاقة ${formatNumber(item.beforeCardQuantity)} • الحركات ${formatNumber(item.beforeMovementQuantity)}`
            : `الحركات ${formatCurrency(item.beforeMovementBookValue ?? 0)} • 1104 ${formatCurrency(item.beforeLedger1104Value ?? 0)}`;
          const proposed = item.axis === "product" && item.proposedCardQuantity !== null
            ? `البطاقة ${formatNumber(item.proposedCardQuantity)}`
            : item.proposedMovementBookValue !== null || item.proposedLedger1104Value !== null
              ? `الحركات ${formatCurrency(item.proposedMovementBookValue ?? 0)} • 1104 ${formatCurrency(item.proposedLedger1104Value ?? 0)}`
              : "بانتظار تحديد المقترح";
          return <TableRow key={item.id}>
            <TableCell className="font-mono">{item.lineNumber}</TableCell>
            <TableCell>
              <Badge variant="secondary" className="mb-1">{inventoryRepairAxisLabel[item.axis]}</Badge>
              {path ? <Link className="block font-medium text-primary hover:underline" to={path}>{inventoryRepairItemLabel(item)}</Link>
                : <div className="font-medium">{inventoryRepairItemLabel(item)}</div>}
            </TableCell>
            <TableCell>{inventoryRepairClassificationLabel[item.classification] ?? item.classification}</TableCell>
            <TableCell>{inventoryRepairTypeLabel[item.repairType] ?? item.repairType}</TableCell>
            <TableCell className="whitespace-nowrap text-sm">{before}</TableCell>
            <TableCell className="whitespace-nowrap text-sm">{proposed}</TableCell>
          </TableRow>;
        })}</TableBody>
      </Table>
    </div>
  );
}

function EventsList({ events, actors }: { events: InventoryRepairEvent[]; actors: Record<string, InventoryRepairActor> }) {
  if (events.length === 0) return <EmptyState icon={FileClock} title="لا توجد أحداث مسجلة" compact />;
  return <Card><CardContent className="divide-y p-0">{events.map((event) => (
    <div key={event.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="font-medium">{inventoryRepairEventLabel[event.eventType] ?? event.eventType}</div>
        <div className="mt-1 text-xs text-muted-foreground">
          {event.fromStatus ? inventoryRepairStatusLabel[event.fromStatus] : "بداية"} ← {event.toStatus ? inventoryRepairStatusLabel[event.toStatus] : "—"}
        </div>
      </div>
      <div className="text-xs text-muted-foreground sm:text-left">
        <div>{formatDateTime(event.createdAt)}</div>
        <div>نفّذ بواسطة: {inventoryRepairActorLabel(actors[event.actorId])}</div>
      </div>
    </div>
  ))}</CardContent></Card>;
}

function EffectsTable({ effects }: { effects: InventoryRepairEffect[] }) {
  if (effects.length === 0) return <EmptyState icon={Layers3} title="لا توجد آثار تنفيذ" description="هذا متوقع قبل تفعيل منفذات المرحلة 2C." compact />;
  return <div className="overflow-x-auto rounded-md border"><Table>
    <TableHeader><TableRow><TableHead>نوع الأثر</TableHead><TableHead>الجدول</TableHead><TableHead>السجل</TableHead><TableHead>التاريخ</TableHead></TableRow></TableHeader>
    <TableBody>{effects.map((effect) => <TableRow key={effect.id}>
      <TableCell>{effect.effectType}</TableCell><TableCell className="font-mono">{effect.tableName}</TableCell>
      <TableCell className="font-mono" dir="ltr">{shortId(effect.recordId)}</TableCell><TableCell>{formatDateTime(effect.createdAt)}</TableCell>
    </TableRow>)}</TableBody>
  </Table></div>;
}

function NotFoundState() {
  return <EmptyState icon={AlertCircle} title="المعالجة غير موجودة" description="قد يكون الرابط غير صحيح أو لا تملك صلاحية قراءة السجل." action={<Button asChild variant="outline"><Link to="/reports/inventory-reconciliation/repairs">العودة إلى السجل</Link></Button>} />;
}

function DetailSkeleton() {
  return <div className="space-y-4" dir="rtl"><Skeleton className="h-16 w-full" /><div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-20" />)}</div><Skeleton className="h-72 w-full" /></div>;
}
