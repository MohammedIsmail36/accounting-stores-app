/**
 * يحول أخطاء Supabase/Postgres إلى رسائل عربية واضحة للمستخدم.
 * يدعم: UNIQUE, CHECK, FK, NOT NULL, RLS, RAISE EXCEPTION custom
 */

interface SupabaseLikeError {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
}

const KNOWN_PATTERNS: Array<{ test: RegExp; ar: (m: RegExpMatchArray) => string }> = [
  {
    test: /REPAIR_ISSUE_ACTIVE/i,
    ar: () => "توجد مسودة أو معالجة نشطة لهذا الانحراف بالفعل. افتح سجل المعالجات لمراجعتها.",
  },
  {
    test: /REPAIR_(CLASSIFICATION_CHANGED|ISSUE_NOT_FOUND|SOURCE_NOT_FOUND|ISSUE_KEY_MISMATCH)/i,
    ar: () => "تغير التشخيص منذ فتح الصفحة. حدّث التقرير ثم أعد المحاولة.",
  },
  {
    test: /REPAIR_ACCESS_DENIED/i,
    ar: () => "ليس لديك صلاحية لإدارة معالجة مخزون.",
  },
  {
    test: /REPAIR_VERSION_CONFLICT/i,
    ar: () => "تغيرت المسودة منذ فتحها. حدّث الصفحة ثم أعد التعديل.",
  },
  {
    test: /REPAIR_STATUS_INVALID/i,
    ar: () => "لم تعد المعالجة في حالة مسودة، لذلك لا يمكن تعديلها.",
  },
  {
    test: /REPAIR_NOT_FOUND/i,
    ar: () => "لم تعد مسودة المعالجة موجودة أو لا تملك صلاحية قراءتها.",
  },
  {
    test: /REPAIR_REQUEST_CONFLICT/i,
    ar: () => "تعذر تأكيد طلب التعديل بأمان. أغلق النافذة ثم أعد المحاولة.",
  },
  {
    test: /REPAIR_(INVALID_HEADER|ITEMS_REQUIRED|TYPE_INVALID_FOR_ISSUE)/i,
    ar: () => "بيانات مسودة المعالجة غير مكتملة أو لا تتوافق مع التشخيص الحالي.",
  },
  // Custom RAISE EXCEPTION من triggers / RPCs (الأولوية القصوى — رسائلنا أصلاً عربية)
  {
    test: /(الفترة مقفلة|الكمية المرتجعة|قيد الإقفال|كمية المرتجع|locked period)/i,
    ar: (m) => m[0],
  },
  // UNIQUE constraint
  {
    test: /duplicate key value violates unique constraint "([^"]+)"/i,
    ar: () => "هذا السجل موجود مسبقاً (قيمة مكررة).",
  },
  // FK violation - insert/update
  {
    test: /insert or update on table "([^"]+)" violates foreign key constraint/i,
    ar: () => "البيانات المرتبطة غير موجودة. تأكد من اختيار قيمة صحيحة.",
  },
  // FK violation - delete
  {
    test: /update or delete on table "([^"]+)" violates foreign key constraint.*on table "([^"]+)"/i,
    ar: (m) => `لا يمكن الحذف — السجل مرتبط بسجلات في (${m[2]}).`,
  },
  // NOT NULL
  {
    test: /null value in column "([^"]+)".*violates not-null/i,
    ar: (m) => `الحقل (${m[1]}) مطلوب ولا يمكن تركه فارغاً.`,
  },
  // CHECK constraint
  {
    test: /new row for relation "([^"]+)" violates check constraint "([^"]+)"/i,
    ar: (m) => `قيمة غير صالحة في (${m[1]}). فشل التحقق: ${m[2]}.`,
  },
  // RLS
  {
    test: /new row violates row-level security policy/i,
    ar: () => "ليس لديك صلاحية لإجراء هذه العملية.",
  },
  {
    test: /permission denied for (table|relation|schema|function)/i,
    ar: () => "ليس لديك صلاحية الوصول لهذه البيانات.",
  },
  // Auth
  {
    test: /invalid login credentials/i,
    ar: () => "بيانات الدخول غير صحيحة.",
  },
  {
    test: /email not confirmed/i,
    ar: () => "يجب تفعيل البريد الإلكتروني أولاً.",
  },
  {
    test: /user already registered/i,
    ar: () => "هذا البريد مسجّل مسبقاً.",
  },
  // Network
  {
    test: /failed to fetch|networkerror|network request failed/i,
    ar: () => "تعذّر الاتصال بالخادم. تحقّق من الإنترنت ثم حاول مرة أخرى.",
  },
  {
    test: /timeout/i,
    ar: () => "انتهت مهلة الطلب. حاول مرة أخرى.",
  },
];

/**
 * يحول خطأ من Supabase/PostgREST إلى رسالة عربية للمستخدم.
 * إذا لم يطابق أي نمط، يعيد الرسالة الأصلية مع رسالة fallback.
 */
export function formatSupabaseError(err: unknown, fallback = "حدث خطأ غير متوقع. حاول مرة أخرى."): string {
  if (!err) return fallback;

  const e = err as SupabaseLikeError;
  const msg = e.message || e.details || (typeof err === "string" ? err : "");

  if (!msg) return fallback;

  for (const { test, ar } of KNOWN_PATTERNS) {
    const m = msg.match(test);
    if (m) return ar(m);
  }

  // إذا الرسالة تبدو إنجليزية تقنية (تحتوي SQLSTATE/relation/column)، نستخدم fallback
  if (/SQLSTATE|relation|column|tuple|pg_/i.test(msg)) {
    return fallback;
  }

  // وإلا نعيدها كما هي (قد تكون رسالة مفهومة من validation داخلي)
  return msg;
}
