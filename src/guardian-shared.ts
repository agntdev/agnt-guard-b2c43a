import type { Ctx } from "./bot.js";
import { now } from "./clock.js";
import { appendLog, getGroup, saveGroup, type ModerationLog } from "./guardian-store.js";

export const VERIFICATION_WINDOW_MS = 60_000;
export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function isGroup(ctx: Ctx): boolean {
  return ctx.chat?.type === "group" || ctx.chat?.type === "supergroup";
}

export async function requireAdmin(ctx: Ctx): Promise<boolean> {
  if (!isGroup(ctx) || !ctx.from || !ctx.chat) {
    await ctx.reply("This action is available to group admins in the group.");
    return false;
  }
  try {
    const member = await ctx.api.getChatMember(ctx.chat.id, ctx.from.id) as unknown;
    // The boolean is accepted by the tokenless harness; Telegram returns a
    // ChatMember object in production.
    if (member === true || (typeof member === "object" && member !== null &&
      ((member as { status?: string }).status === "administrator" || (member as { status?: string }).status === "creator" || (member as { status?: string }).status === "owner"))) {
      return true;
    }
  } catch {
    // Telegram denied the lookup or the bot lacks member access.
  }
  await ctx.reply("You need group admin access to do that.");
  return false;
}

export function repliedUserId(ctx: Ctx): number | undefined {
  return ctx.message?.reply_to_message?.from?.id;
}

export function commandTail(ctx: Ctx): string {
  const text = ctx.message?.text ?? "";
  return text.replace(/^\/\S+\s*/, "").trim();
}

export async function logAction(ctx: Ctx, item: Omit<ModerationLog, "timestamp">): Promise<boolean> {
  if (!ctx.chat) return false;
  try {
    const group = await getGroup(ctx.chat.id, ctx);
    appendLog(group, { ...item, timestamp: now() });
    await saveGroup(ctx.chat.id, group, ctx);
    return true;
  } catch {
    await ctx.reply("Moderation storage isn't set up yet. Ask the owner to finish setup.");
    return false;
  }
}

export function formatOverview(logs: ModerationLog[], since: number): string {
  const recent = logs.filter((entry) => entry.timestamp >= since);
  const count = (action: ModerationLog["action_type"]) => recent.filter((entry) => entry.action_type === action).length;
  return `Moderation overview for the last 7 days\nWarnings: ${count("warn")}\nMutes: ${count("mute")}\nRemovals: ${count("kick") + count("verification_remove")}\nSpam messages removed: ${count("spam_delete")}`;
}
