import { randomBytes } from "node:crypto";

const EXPECTED_URL = "https://dunzfxurefzlaamgghys.supabase.co";
const TEST_EMAIL = "sales.security.staging@example.com";

const baseUrl = process.env.STAGING_SUPABASE_URL;
const anonKey = process.env.STAGING_SUPABASE_ANON_KEY;
const serviceKey = process.env.STAGING_SUPABASE_SERVICE_KEY;

if (process.env.ALLOW_STAGING_SECURITY_TEST !== "yes") {
  throw new Error("Set ALLOW_STAGING_SECURITY_TEST=yes to run this Staging-only check.");
}
if (baseUrl !== EXPECTED_URL) {
  throw new Error(`Refusing unexpected Supabase project: ${baseUrl || "missing"}`);
}
if (!anonKey || !serviceKey) {
  throw new Error("Both Staging anon and service-role keys are required.");
}

async function api(path, { key, token = key, method = "GET", body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { ok: response.ok, status: response.status, text };
}

async function requireOk(result, label) {
  if (!result.ok) {
    throw new Error(`${label} failed with HTTP ${result.status}: ${result.text.slice(0, 240)}`);
  }
  return result.text ? JSON.parse(result.text) : null;
}

async function findOrCreateTestUser(password) {
  const listed = await requireOk(
    await api("/auth/v1/admin/users?page=1&per_page=1000", { key: serviceKey }),
    "list auth users",
  );
  let user = listed.users?.find((candidate) => candidate.email === TEST_EMAIL);

  if (!user) {
    user = await requireOk(
      await api("/auth/v1/admin/users", {
        key: serviceKey,
        method: "POST",
        body: {
          email: TEST_EMAIL,
          password,
          email_confirm: true,
          user_metadata: { full_name: "موظف مبيعات اختبار أمني" },
        },
      }),
      "create sales test user",
    );
  } else {
    user = await requireOk(
      await api(`/auth/v1/admin/users/${user.id}`, {
        key: serviceKey,
        method: "PUT",
        body: { password, email_confirm: true },
      }),
      "refresh sales test user password",
    );
  }

  return user;
}

async function setRole(userId, role) {
  await requireOk(
    await api(`/rest/v1/user_roles?user_id=eq.${encodeURIComponent(userId)}`, {
      key: serviceKey,
      method: "DELETE",
    }),
    "clear test role",
  );
  await requireOk(
    await api("/rest/v1/user_roles", {
      key: serviceKey,
      method: "POST",
      body: { user_id: userId, role },
    }),
    `assign ${role} test role`,
  );
}

async function signIn(password) {
  const session = await requireOk(
    await api("/auth/v1/token?grant_type=password", {
      key: anonKey,
      token: anonKey,
      method: "POST",
      body: { email: TEST_EMAIL, password },
    }),
    "sign in sales test user",
  );
  return session.access_token;
}

const products = await requireOk(
  await api("/rest/v1/products?select=id,selling_price,quantity_on_hand&order=code.asc&limit=1", {
    key: serviceKey,
  }),
  "load one Staging product",
);
if (!products[0]?.id) throw new Error("The Staging seed product is missing.");

const customers = await requireOk(
  await api("/rest/v1/customers?select=id&order=code.asc&limit=1", { key: serviceKey }),
  "load one Staging customer",
);
if (!customers[0]?.id) throw new Error("The Staging seed customer is missing.");

const rpcCalls = [
  ["get_avg_purchase_price", { _product_id: products[0].id }],
  ["get_inventory_movements_summary", { p_date_from: null, p_date_to: null, p_product_id: null }],
  ["get_products_summary", {}],
  ["inventory_product_state", { p_as_of: "2026-09-05" }],
  ["get_inventory_aging", { p_as_of: "2026-09-05", p_slow_days: null, p_dead_days: null }],
  ["get_inventory_kpis", { p_date_from: "2026-09-01", p_date_to: "2026-09-05" }],
  [
    "get_inventory_reorder",
    {
      p_date_from: "2026-09-01",
      p_date_to: "2026-09-05",
      p_lead_time_days: null,
      p_target_days: null,
    },
  ],
  ["get_inventory_valuation", { p_as_of: "2026-09-05" }],
];

async function verifyActor(label, key, token, shouldAllow) {
  const statuses = [];
  for (const [name, body] of rpcCalls) {
    const result = await api(`/rest/v1/rpc/${name}`, {
      key,
      token,
      method: "POST",
      body,
    });
    if (result.ok !== shouldAllow) {
      throw new Error(
        `${label} ${name}: expected ${shouldAllow ? "allow" : "deny"}, got HTTP ${result.status}: ${result.text.slice(0, 240)}`,
      );
    }
    statuses.push(`${name}:${result.status}`);
  }
  console.log(`${label} ${shouldAllow ? "allowed" : "denied"}: ${statuses.join(", ")}`);
}

async function verifySalesCatalog(label, key, token, shouldAllow) {
  const result = await api("/rest/v1/rpc/get_sales_product_catalog", {
    key,
    token,
    method: "POST",
    body: {},
  });
  if (result.ok !== shouldAllow) {
    throw new Error(
      `${label} sales catalog: expected ${shouldAllow ? "allow" : "deny"}, got HTTP ${result.status}: ${result.text.slice(0, 240)}`,
    );
  }
  if (!shouldAllow) {
    console.log(`${label} sales catalog denied: ${result.status}`);
    return;
  }

  const rows = JSON.parse(result.text);
  const allowedFields = new Set([
    "id",
    "code",
    "name",
    "barcode",
    "model_number",
    "selling_price",
    "quantity_on_hand",
    "is_active",
    "product_brands",
  ]);
  const forbiddenFields = [
    "purchase_price",
    "unit_cost",
    "total_cost",
    "cost",
    "profit",
    "margin",
  ];

  for (const row of rows) {
    const unexpected = Object.keys(row).filter((field) => !allowedFields.has(field));
    if (unexpected.length > 0) {
      throw new Error(`Sales catalog returned unexpected fields: ${unexpected.join(", ")}`);
    }
    for (const field of forbiddenFields) {
      if (Object.prototype.hasOwnProperty.call(row, field)) {
        throw new Error(`Sales catalog exposed forbidden field: ${field}`);
      }
    }
  }

  console.log(`${label} sales catalog allowed and cost-free: ${rows.length} products`);
}

async function verifyDirectCostTables(label, key, token, shouldSeeRows) {
  const queries = [
    ["products", "/rest/v1/products?select=id,purchase_price&limit=1"],
    [
      "inventory_movements",
      "/rest/v1/inventory_movements?select=id,unit_cost,total_cost&limit=1",
    ],
  ];

  for (const [table, path] of queries) {
    const rows = await requireOk(await api(path, { key, token }), `${label} direct ${table}`);
    if ((rows.length > 0) !== shouldSeeRows) {
      throw new Error(
        `${label} direct ${table}: expected ${shouldSeeRows ? "visible rows" : "no rows"}, got ${rows.length}`,
      );
    }
  }

  console.log(`${label} direct cost tables ${shouldSeeRows ? "visible" : "hidden"}`);
}

async function verifyPostedCancellationGuard(label, key, token, shouldAuthorize) {
  const missingId = "00000000-0000-0000-0000-000000000000";
  const calls = [
    ["cancel_sales_invoice", { p_invoice_id: missingId }],
    ["cancel_sales_return", { p_return_id: missingId }],
  ];

  for (const [name, body] of calls) {
    const result = await requireOk(
      await api(`/rest/v1/rpc/${name}`, { key, token, method: "POST", body }),
      `${label} ${name}`,
    );
    if (result.success !== false) {
      throw new Error(`${label} ${name}: an absent test document must not be cancelled`);
    }
    const isRoleDenial = String(result.error || "").includes("فقط");
    if (isRoleDenial === shouldAuthorize) {
      throw new Error(
        `${label} ${name}: expected ${shouldAuthorize ? "authorized gateway" : "role denial"}, got ${result.error}`,
      );
    }
  }

  console.log(`${label} posted sales cancellation ${shouldAuthorize ? "authorized" : "denied"}`);
}

async function verifyAtomicSalesPosting(accessToken) {
  const reference = "SECURITY-GUARD-9D2C1";
  const existing = await requireOk(
    await api(
      `/rest/v1/sales_invoices?select=id,status&reference=eq.${reference}&limit=1`,
      { key: serviceKey },
    ),
    "find security test invoice",
  );
  if (existing[0]?.status === "cancelled") {
    console.log("atomic sales gateway already verified by the retained cancelled test invoice");
    return;
  }
  if (existing.length > 0) {
    throw new Error(`Security test invoice has unexpected status: ${existing[0].status}`);
  }

  const price = Number(products[0].selling_price);
  const quantityBefore = Number(products[0].quantity_on_hand);
  const draft = await requireOk(
    await api("/rest/v1/rpc/save_sales_invoice_draft", {
      key: anonKey,
      token: accessToken,
      method: "POST",
      body: {
        p_invoice_id: null,
        p_invoice: {
          customer_id: customers[0].id,
          invoice_date: "2026-09-05",
          subtotal: price,
          discount: 0,
          tax: 0,
          total: price,
          loyalty_points_redeemed: 0,
          loyalty_discount: 0,
          notes: "اختبار حماية تكلفة 9D-2C-1",
          reference,
        },
        p_items: [
          {
            product_id: products[0].id,
            description: "اختبار بوابة البيع الذرية",
            quantity: 1,
            unit_price: price,
            discount: 0,
            total: price,
            net_total: price,
          },
        ],
      },
    }),
    "create security test draft",
  );
  if (!draft.success || !draft.invoice_id) {
    throw new Error(`Draft gateway rejected the sales actor: ${JSON.stringify(draft)}`);
  }

  const posted = await requireOk(
    await api("/rest/v1/rpc/post_sales_invoice", {
      key: anonKey,
      token: accessToken,
      method: "POST",
      body: { p_invoice_id: draft.invoice_id },
    }),
    "post security test invoice",
  );
  if (!posted.success) {
    throw new Error(`Post gateway rejected the sales actor: ${JSON.stringify(posted)}`);
  }

  const quantityAfterPost = await requireOk(
    await api(`/rest/v1/products?select=quantity_on_hand&id=eq.${products[0].id}`, {
      key: serviceKey,
    }),
    "verify posted stock",
  );
  if (Number(quantityAfterPost[0]?.quantity_on_hand) !== quantityBefore - 1) {
    throw new Error("Atomic posting did not reduce the Staging stock by one.");
  }

  const cancelled = await requireOk(
    await api("/rest/v1/rpc/cancel_sales_invoice", {
      key: anonKey,
      token: accessToken,
      method: "POST",
      body: { p_invoice_id: draft.invoice_id },
    }),
    "cancel security test invoice",
  );
  if (!cancelled.success) {
    throw new Error(`Cancel gateway rejected the sales actor: ${JSON.stringify(cancelled)}`);
  }

  const quantityAfterCancel = await requireOk(
    await api(`/rest/v1/products?select=quantity_on_hand&id=eq.${products[0].id}`, {
      key: serviceKey,
    }),
    "verify restored stock",
  );
  if (Number(quantityAfterCancel[0]?.quantity_on_hand) !== quantityBefore) {
    throw new Error("Cancelling the security test invoice did not restore Staging stock.");
  }

  console.log("sales atomic post/cancel allowed and stock restored");
}

const password = `Stg-${randomBytes(18).toString("hex")}!Aa1`;
const user = await findOrCreateTestUser(password);
let roleRestored = false;

try {
  await setRole(user.id, "sales");
  const accessToken = await signIn(password);

  await verifyActor("anon", anonKey, anonKey, false);
  await verifySalesCatalog("anon", anonKey, anonKey, false);
  await verifyDirectCostTables("anon", anonKey, anonKey, false);
  await verifyActor("sales", anonKey, accessToken, false);
  await verifySalesCatalog("sales", anonKey, accessToken, true);
  await verifyDirectCostTables("sales", anonKey, accessToken, false);
  await verifyPostedCancellationGuard("sales", anonKey, accessToken, false);

  await setRole(user.id, "accountant");
  await verifyActor("accountant", anonKey, accessToken, true);
  await verifySalesCatalog("accountant", anonKey, accessToken, true);
  await verifyDirectCostTables("accountant", anonKey, accessToken, true);
  await verifyPostedCancellationGuard("accountant", anonKey, accessToken, true);

  await setRole(user.id, "sales");
  roleRestored = true;

  await verifyAtomicSalesPosting(accessToken);

  await verifyActor("service_role", serviceKey, serviceKey, true);
  await verifySalesCatalog("service_role", serviceKey, serviceKey, true);
  await verifyDirectCostTables("service_role", serviceKey, serviceKey, true);
} finally {
  if (!roleRestored) await setRole(user.id, "sales");
}

console.log(`Security test user retained as sales: ${TEST_EMAIL}`);
console.log("Cost-sensitive RPC guard verification passed.");
