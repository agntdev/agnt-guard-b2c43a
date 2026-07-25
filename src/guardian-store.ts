/**
 * Durable GroupGuardian data. One explicit record per group means reads never
 * scan Redis: newcomers, logs, and flood windows are all addressed by chat id.
 */
export interface Newcomer {
  user_id: number;
  join_time: number;
  verified_status: boolean;
}

export interface ModerationLog {
  action_type: "warn" | "mute" | "kick" | "spam_delete" | "verification_remove";
  user_id: number;
  timestamp: number;
  reason: string;
}

export interface RulesConfiguration {
  welcome_text: string;
  rules_text: string;
  autoaction_thresholds: { floodMessages: number; floodWindowMs: number };
}

export interface GroupState {
  config: RulesConfiguration;
  newcomers: Record<string, Newcomer>;
  logs: ModerationLog[];
  flood: Record<string, number[]>;
  last_weekly_overview: number;
}

const defaults = (): GroupState => ({
  config: {
    welcome_text: "Welcome. Tap the button below within one minute to verify your access.",
    rules_text: "Follow the group rules and do not post spam.",
    autoaction_thresholds: { floodMessages: 10, floodWindowMs: 10_000 },
  },
  newcomers: {},
  logs: [],
  flood: {},
  last_weekly_overview: 0,
});

interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
}

interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T>(): Promise<T | null>;
  run(): Promise<unknown>;
}

interface D1Database {
  prepare(query: string): D1Statement;
  exec(query: string): Promise<unknown>;
}

interface RuntimeContext {
  env?: { DB?: unknown };
}

let clientPromise: Promise<RedisClient> | undefined;

async function client(): Promise<RedisClient> {
  if (clientPromise) return clientPromise;
  const url = typeof process === "undefined" ? undefined : process.env.REDIS_URL;
  if (!url) throw new Error("durable storage is unavailable");
  clientPromise = (async () => {
    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);
    // ioredis is loaded only in the Node deployment path. Workers never load it.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pkg: any = require("ioredis");
    const Redis = pkg.default ?? pkg.Redis ?? pkg;
    return new Redis(url, { maxRetriesPerRequest: null, lazyConnect: false }) as RedisClient;
  })();
  return clientPromise;
}

function key(chatId: number): string {
  return `groupguardian:group:${chatId}`;
}

export async function getGroup(chatId: number, runtime?: unknown): Promise<GroupState> {
  const d1 = (runtime as RuntimeContext | undefined)?.env?.DB as D1Database | undefined;
  if (d1) {
    await d1.exec("CREATE TABLE IF NOT EXISTS groupguardian_state (chat_id TEXT PRIMARY KEY, payload TEXT NOT NULL)");
    const row = await d1.prepare("SELECT payload FROM groupguardian_state WHERE chat_id = ?").bind(String(chatId)).first<{ payload: string }>();
    return parseGroup(row?.payload);
  }
  const raw = await (await client()).get(key(chatId));
  return parseGroup(raw ?? undefined);
}

function parseGroup(raw?: string): GroupState {
  if (!raw) return defaults();
  try {
    const parsed = JSON.parse(raw) as Partial<GroupState>;
    return {
      ...defaults(),
      ...parsed,
      config: { ...defaults().config, ...parsed.config },
      newcomers: parsed.newcomers ?? {},
      logs: parsed.logs ?? [],
      flood: parsed.flood ?? {},
    };
  } catch {
    return defaults();
  }
}

export async function saveGroup(chatId: number, state: GroupState, runtime?: unknown): Promise<void> {
  const d1 = (runtime as RuntimeContext | undefined)?.env?.DB as D1Database | undefined;
  if (d1) {
    await d1.exec("CREATE TABLE IF NOT EXISTS groupguardian_state (chat_id TEXT PRIMARY KEY, payload TEXT NOT NULL)");
    await d1.prepare("INSERT INTO groupguardian_state (chat_id, payload) VALUES (?, ?) ON CONFLICT(chat_id) DO UPDATE SET payload = excluded.payload").bind(String(chatId), JSON.stringify(state)).run();
    return;
  }
  await (await client()).set(key(chatId), JSON.stringify(state));
}

export async function updateGroup(
  chatId: number,
  change: (state: GroupState) => void,
  runtime?: unknown,
): Promise<GroupState> {
  const state = await getGroup(chatId, runtime);
  change(state);
  await saveGroup(chatId, state, runtime);
  return state;
}

export function appendLog(state: GroupState, item: ModerationLog): void {
  state.logs.push(item);
  // Retain the latest entries without growing a group record forever.
  if (state.logs.length > 200) state.logs.splice(0, state.logs.length - 200);
}
