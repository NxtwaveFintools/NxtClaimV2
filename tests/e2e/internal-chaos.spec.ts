import { loadEnvConfig } from "@next/env";
import {
  chromium,
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

loadEnvConfig(process.cwd());

const DEFAULT_PASSWORD = process.env.E2E_DEFAULT_PASSWORD ?? "password123";
const CHAOS_DURATION_MS = 75_000;
const MAX_SWARM_USERS = 10;
const TARGET_FINANCE_ROUTE = "/dashboard/finance";

type UserRow = {
  id: string;
  email: string;
};

type DepartmentRow = {
  approver_1_id: string | null;
  approver_2_id: string | null;
};

type FinanceApproverRow = {
  user_id: string;
};

type ActorRole = "EMPLOYEE" | "HOD" | "FINANCE" | "FOUNDER";

type ChaosActor = {
  id: string;
  email: string;
  name: string;
  role: ActorRole;
};

type ChaosSession = {
  actor: ChaosActor;
  context: BrowserContext;
  page: Page;
};

type TableSnapshot = {
  count: number | null;
  available: boolean;
  note?: string;
};

type ChaosSnapshot = {
  claims: TableSnapshot;
  wallets: TableSnapshot;
};

function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for internal chaos testing.",
    );
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function randomInt(maxExclusive: number): number {
  if (maxExclusive <= 1) {
    return 0;
  }

  return Math.floor(Math.random() * maxExclusive);
}

function shuffleInPlace<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    const temp = items[i];
    items[i] = items[j];
    items[j] = temp;
  }

  return items;
}

function isMissingRelationError(message: string | undefined): boolean {
  const normalized = (message ?? "").toLowerCase();
  return normalized.includes("does not exist") || normalized.includes("could not find");
}

function isMissingColumnError(message: string | undefined): boolean {
  const normalized = (message ?? "").toLowerCase();
  return normalized.includes("column") && normalized.includes("does not exist");
}

function attachCrashListeners(page: Page, actorLabel: string): void {
  page.on("pageerror", (error) => {
    console.error(`[FATAL JS CRASH][${actorLabel}]`, error);
  });

  page.on("console", (message) => {
    if (message.type() === "error") {
      console.error(`[CONSOLE ERR][${actorLabel}]`, message.text());
    }
  });
}

async function snapshotClaimsAndWallets(): Promise<ChaosSnapshot> {
  const client = getAdminClient();

  const claimsResult = await client.from("claims").select("id", { count: "exact", head: true });
  if (claimsResult.error) {
    throw new Error(`Failed to snapshot claims table: ${claimsResult.error.message}`);
  }

  const walletsResult = await client
    .from("wallets")
    .select("user_id", { count: "exact", head: true });

  const claimsSnapshot: TableSnapshot = {
    count: claimsResult.count ?? 0,
    available: true,
  };

  if (walletsResult.error) {
    if (isMissingRelationError(walletsResult.error.message)) {
      return {
        claims: claimsSnapshot,
        wallets: {
          count: null,
          available: false,
          note: "wallets table not available in current schema",
        },
      };
    }

    throw new Error(`Failed to snapshot wallets table: ${walletsResult.error.message}`);
  }

  return {
    claims: claimsSnapshot,
    wallets: {
      count: walletsResult.count ?? 0,
      available: true,
    },
  };
}

async function fetchSwarmActors(limit: number): Promise<ChaosActor[]> {
  const client = getAdminClient();

  const [usersResult, financeResult] = await Promise.all([
    client.from("users").select("id, email").eq("is_active", true).limit(200),
    client.from("master_finance_approvers").select("user_id").eq("is_active", true),
  ]);

  // Prefer *_id columns, then fall back to legacy approver_1/approver_2 naming.
  let departmentsResult = await client
    .from("master_departments")
    .select("approver_1_id, approver_2_id")
    .eq("is_active", true);

  if (departmentsResult.error && isMissingColumnError(departmentsResult.error.message)) {
    const fallback = await client
      .from("master_departments")
      .select("approver_1, approver_2")
      .eq("is_active", true);

    if (fallback.error) {
      departmentsResult = {
        data: null,
        error: fallback.error,
        count: null,
        status: fallback.status,
        statusText: fallback.statusText,
      };
    } else {
      const mappedRows = (
        (fallback.data ?? []) as Array<{ approver_1: string | null; approver_2: string | null }>
      ).map((row) => ({
        approver_1_id: row.approver_1,
        approver_2_id: row.approver_2,
      }));

      departmentsResult = {
        data: mappedRows,
        error: null,
        count: fallback.count,
        status: fallback.status,
        statusText: fallback.statusText,
      };
    }
  }

  if (usersResult.error) {
    throw new Error(`Failed to fetch active users: ${usersResult.error.message}`);
  }
  if (departmentsResult.error) {
    throw new Error(`Failed to fetch department approvers: ${departmentsResult.error.message}`);
  }
  if (financeResult.error) {
    throw new Error(`Failed to fetch finance approvers: ${financeResult.error.message}`);
  }

  const users = (usersResult.data ?? []) as UserRow[];
  const departments = (departmentsResult.data ?? []) as DepartmentRow[];
  const financeRows = (financeResult.data ?? []) as FinanceApproverRow[];

  const hodIds = new Set(
    departments.map((row) => row.approver_1_id).filter((id): id is string => Boolean(id)),
  );
  const founderIds = new Set(
    departments.map((row) => row.approver_2_id).filter((id): id is string => Boolean(id)),
  );
  const financeIds = new Set(financeRows.map((row) => row.user_id));

  const byRole: Record<ActorRole, ChaosActor[]> = {
    EMPLOYEE: [],
    HOD: [],
    FINANCE: [],
    FOUNDER: [],
  };

  for (const user of users) {
    if (!user.email) {
      continue;
    }

    let resolvedRole: ActorRole = "EMPLOYEE";
    if (financeIds.has(user.id)) {
      resolvedRole = "FINANCE";
    } else if (hodIds.has(user.id)) {
      resolvedRole = "HOD";
    } else if (founderIds.has(user.id)) {
      resolvedRole = "FOUNDER";
    }

    byRole[resolvedRole].push({
      id: user.id,
      email: user.email,
      name: user.email,
      role: resolvedRole,
    });
  }

  const shuffledEmployees = shuffleInPlace([...byRole.EMPLOYEE]);
  const shuffledHods = shuffleInPlace([...byRole.HOD]);
  const shuffledFinances = shuffleInPlace([...byRole.FINANCE]);
  const shuffledFounders = shuffleInPlace([...byRole.FOUNDER]);

  const selected: ChaosActor[] = [];
  const seen = new Set<string>();

  const pushUnique = (actor: ChaosActor | undefined) => {
    if (!actor || seen.has(actor.id)) {
      return;
    }
    selected.push(actor);
    seen.add(actor.id);
  };

  pushUnique(shuffledEmployees[0]);
  pushUnique(shuffledHods[0]);
  pushUnique(shuffledFinances[0]);
  pushUnique(shuffledFounders[0]);

  const roundRobinBuckets: ChaosActor[][] = [
    shuffledEmployees.slice(1),
    shuffledHods.slice(1),
    shuffledFinances.slice(1),
    shuffledFounders.slice(1),
  ];

  while (selected.length < limit) {
    let progress = false;

    for (const bucket of roundRobinBuckets) {
      if (selected.length >= limit) {
        break;
      }

      const candidate = bucket.shift();
      if (!candidate) {
        continue;
      }

      progress = true;
      pushUnique(candidate);
    }

    if (!progress) {
      break;
    }
  }

  if (selected.length < Math.min(limit, 4)) {
    throw new Error(
      `Insufficient role diversity for swarm test. Selected ${selected.length} actors across available buckets.`,
    );
  }

  return selected.slice(0, limit);
}

async function loginToContext(
  context: BrowserContext,
  email: string,
  password: string,
): Promise<Page> {
  const loginResponse = await context.request.post("/api/auth/email-login", {
    data: {
      email,
      password,
    },
  });

  if (!loginResponse.ok()) {
    throw new Error(`Login failed for ${email}: HTTP ${loginResponse.status()}`);
  }

  const loginPayload = (await loginResponse.json()) as {
    data?: {
      session?: {
        accessToken?: string;
        refreshToken?: string;
      };
    };
    error?: {
      message?: string;
    };
  };

  const accessToken = loginPayload.data?.session?.accessToken;
  const refreshToken = loginPayload.data?.session?.refreshToken;
  if (!accessToken || !refreshToken) {
    throw new Error(`Login session tokens missing for ${email}.`);
  }

  const sessionResponse = await context.request.post("/api/auth/session", {
    data: {
      accessToken,
      refreshToken,
    },
  });

  if (!sessionResponse.ok()) {
    throw new Error(`Session bootstrap failed for ${email}: HTTP ${sessionResponse.status()}`);
  }

  const page = await context.newPage();
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  return page;
}

async function createSwarmSessions(
  browser: Browser,
  actors: ChaosActor[],
): Promise<ChaosSession[]> {
  return Promise.all(
    actors.map(async (actor) => {
      const context = await browser.newContext();
      const page = await loginToContext(context, actor.email, DEFAULT_PASSWORD);
      attachCrashListeners(page, `${actor.role}:${actor.email}`);
      return { actor, context, page };
    }),
  );
}

async function closeSwarmSessions(sessions: ChaosSession[]): Promise<void> {
  await Promise.all(
    sessions.map(async (session) => {
      try {
        await session.context.close();
      } catch {
        // Ignore teardown races.
      }
    }),
  );
}

async function randomSelectFromCombobox(page: Page): Promise<void> {
  const comboboxes = page.getByRole("combobox");
  const count = await comboboxes.count();
  if (count === 0) {
    return;
  }

  const limit = Math.min(count, 5);
  for (let index = 0; index < limit; index += 1) {
    const combo = comboboxes.nth(randomInt(count));

    try {
      await combo.scrollIntoViewIfNeeded({ timeout: 200 });
      await combo.click({ timeout: 500 });

      const comboTag = await combo.evaluate((node) => node.tagName.toLowerCase()).catch(() => "");
      if (comboTag === "select") {
        const optionValues = await combo
          .locator("option")
          .evaluateAll((options) =>
            options
              .map((option) => (option as HTMLOptionElement).value)
              .filter((value) => value && value.trim().length > 0),
          )
          .catch(() => [] as string[]);

        if (optionValues.length > 0) {
          const value = optionValues[randomInt(optionValues.length)];
          await combo.selectOption(value, { timeout: 500 }).catch(() => null);
        }
      } else {
        const options = page.getByRole("option");
        const optionCount = await options.count();
        if (optionCount > 0) {
          const option = options.nth(randomInt(optionCount));
          await option.click({ timeout: 500 }).catch(() => null);
        }
      }
    } catch {
      // Best-effort fuzzing.
    }
  }
}

async function fuzzAndClick(page: Page): Promise<void> {
  const payloads = [
    "9999999",
    "-500",
    "' OR 1=1 --",
    "<script>alert('xss')</script>",
    '"; DROP TABLE claims; --',
  ];

  const inputLike = page.locator("input:not([type='hidden']):not([type='file']), textarea");
  const totalInputs = await inputLike.count();
  const inputOps = Math.min(totalInputs, 30);

  for (let index = 0; index < inputOps; index += 1) {
    const locator = inputLike.nth(randomInt(totalInputs));
    const payload = payloads[randomInt(payloads.length)];

    try {
      const type = (await locator.getAttribute("type")) ?? "text";
      if (type === "checkbox" || type === "radio") {
        await locator.click({ timeout: 300 }).catch(() => null);
      } else {
        await locator.fill(payload, { timeout: 400 }).catch(() => null);
      }
    } catch {
      // Best-effort fuzzing.
    }
  }

  await randomSelectFromCombobox(page);

  const clickable = page.locator("button, a, [role='button']");
  const clickableCount = await clickable.count();
  if (clickableCount === 0) {
    return;
  }

  const clicks = Math.min(clickableCount, 6);
  for (let index = 0; index < clicks; index += 1) {
    try {
      await clickable
        .nth(randomInt(clickableCount))
        .click({ timeout: 450 })
        .catch(() => null);
    } catch {
      // Best-effort fuzzing.
    }
  }
}

async function probeFinanceRouteLeak(page: Page, actor: ChaosActor): Promise<string | null> {
  if (actor.role === "finance") {
    return null;
  }

  try {
    const response = await page.goto(TARGET_FINANCE_ROUTE, { waitUntil: "domcontentloaded" });
    const status = response?.status() ?? 0;
    const finalUrl = page.url();
    const pageText = await page
      .locator("body")
      .innerText()
      .catch(() => "");
    const lowerText = pageText.toLowerCase();

    const blockedByStatus = [401, 403, 404].includes(status);
    const blockedByRedirect = !finalUrl.includes(TARGET_FINANCE_ROUTE);
    const blockedByMessage =
      lowerText.includes("not found") ||
      lowerText.includes("unauthorized") ||
      lowerText.includes("access denied") ||
      lowerText.includes("forbidden") ||
      lowerText.includes("sign in");

    if (blockedByStatus || blockedByRedirect || blockedByMessage) {
      return null;
    }

    return `Potential finance-route leak for ${actor.email}: status=${status}, url=${finalUrl}`;
  } catch (error) {
    return `Finance-route probe failed for ${actor.email}: ${error instanceof Error ? error.message : "unknown error"}`;
  }
}

async function assertWalletIntegrity(): Promise<void> {
  const client = getAdminClient();

  const walletCheck = await client
    .from("wallets")
    .select("user_id, petty_cash_balance")
    .lt("petty_cash_balance", 0)
    .limit(10);

  if (walletCheck.error) {
    if (
      isMissingRelationError(walletCheck.error.message) ||
      isMissingColumnError(walletCheck.error.message)
    ) {
      console.warn(`[CHAOS][WARN] Wallet integrity check skipped: ${walletCheck.error.message}`);
      return;
    }

    throw new Error(`Wallet integrity query failed: ${walletCheck.error.message}`);
  }

  const rows = walletCheck.data ?? [];
  expect(
    rows.length,
    `Found wallets with negative petty_cash_balance: ${JSON.stringify(rows)}`,
  ).toBe(0);
}

async function assertWorkflowBypassIntegrity(): Promise<void> {
  const client = getAdminClient();

  const timestampBasedCheck = await client
    .from("claims")
    .select("id, finance_approved_at, hod_approved_at")
    .not("finance_approved_at", "is", null)
    .is("hod_approved_at", null)
    .limit(10);

  if (!timestampBasedCheck.error) {
    expect(
      (timestampBasedCheck.data ?? []).length,
      `Workflow bypass rows detected: ${JSON.stringify(timestampBasedCheck.data ?? [])}`,
    ).toBe(0);
    return;
  }

  if (!isMissingColumnError(timestampBasedCheck.error.message)) {
    throw new Error(`Workflow bypass timestamp check failed: ${timestampBasedCheck.error.message}`);
  }

  const statusBasedFallback = await client
    .from("claims")
    .select("id, status, assigned_l1_approver_id, assigned_l2_approver_id")
    .in("status", ["Finance Approved - Payment under process", "Payment Done - Closed"])
    .is("assigned_l1_approver_id", null)
    .limit(10);

  if (statusBasedFallback.error) {
    throw new Error(`Workflow bypass fallback query failed: ${statusBasedFallback.error.message}`);
  }

  expect(
    (statusBasedFallback.data ?? []).length,
    `Status-based workflow bypass candidates detected: ${JSON.stringify(statusBasedFallback.data ?? [])}`,
  ).toBe(0);
}

test.describe("Internal Chaos Monkey Engine", () => {
  test.setTimeout(300000);

  test("swarm chaos exploration with RLS and integrity checks", async () => {
    const browser = await chromium.launch({
      headless: true,
      args: ["--disable-dev-shm-usage"],
    });

    const sessions: ChaosSession[] = [];

    try {
      const preChaosSnapshot = await snapshotClaimsAndWallets();
      console.info("[CHAOS] Pre-chaos snapshot", preChaosSnapshot);

      const actors = await fetchSwarmActors(MAX_SWARM_USERS);
      const createdSessions = await createSwarmSessions(browser, actors);
      sessions.push(...createdSessions);

      const rlsLeakFindings: string[] = [];

      const endAt = Date.now() + CHAOS_DURATION_MS;
      while (Date.now() < endAt) {
        await Promise.all(
          sessions.map(async (session) => {
            try {
              const pages = ["/dashboard", "/claims/new", "/dashboard/my-claims"];
              const target = pages[randomInt(pages.length)];
              await session.page.goto(target, {
                waitUntil: "domcontentloaded",
                timeout: 10_000,
              });

              await fuzzAndClick(session.page);

              const leak = await probeFinanceRouteLeak(session.page, session.actor);
              if (leak) {
                rlsLeakFindings.push(leak);
              }
            } catch {
              // Chaos loop intentionally continues.
            }
          }),
        );
      }

      await assertWalletIntegrity();
      await assertWorkflowBypassIntegrity();

      const postChaosSnapshot = await snapshotClaimsAndWallets();
      console.info("[CHAOS] Post-chaos snapshot", postChaosSnapshot);

      expect(
        rlsLeakFindings,
        `Potential RLS/route leaks detected during chaos:\n${rlsLeakFindings.join("\n")}`,
      ).toEqual([]);
    } finally {
      await closeSwarmSessions(sessions);
      await browser.close();
    }
  });
});
