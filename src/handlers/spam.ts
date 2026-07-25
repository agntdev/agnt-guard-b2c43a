import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { now } from "../clock.js";
import { appendLog, getGroup, saveGroup } from "../guardian-store.js";
import { WEEK_MS, formatOverview, isGroup } from "../guardian-shared.js";

const composer = new Composer<Ctx>();
const linkPattern = /(?:https?:\/\/|www\.)\S+/i;

/**
 * Telegram does not expose account creation dates. The real signal available to
 * a bot is a member who joined recently and has not completed verification; we
 * apply link and flood checks to that high-risk window without claiming to know
 * an account's age.
 */
composer.on("message:text", async (ctx, next) => {
  if (!ctx.chat || !ctx.from || !ctx.message || !isGroup(ctx) || ctx.message.text.startsWith("/")) return next();
  try {
    const state = await getGroup(ctx.chat.id, ctx);
    const member = state.newcomers[String(ctx.from.id)];
    if (!member || member.verified_status || member.join_time + 24 * 60 * 60 * 1000 < now()) return;
    const cutoff = now() - state.config.autoaction_thresholds.floodWindowMs;
    const times = (state.flood[String(ctx.from.id)] ?? []).filter((time) => time >= cutoff);
    times.push(now());
    state.flood[String(ctx.from.id)] = times;
    const spamReason = linkPattern.test(ctx.message.text)
      ? "Link posted during verification."
      : times.length >= state.config.autoaction_thresholds.floodMessages
        ? "Flood threshold reached."
        : undefined;
    if (!spamReason) { await saveGroup(ctx.chat.id, state, ctx); return; }
    try {
      await ctx.api.deleteMessage(ctx.chat.id, ctx.message.message_id);
      appendLog(state, { action_type: "spam_delete", user_id: ctx.from.id, timestamp: now(), reason: spamReason });
      if (state.last_weekly_overview + WEEK_MS <= now()) {
        state.last_weekly_overview = now();
        await ctx.reply(formatOverview(state.logs, now() - WEEK_MS));
      }
      await saveGroup(ctx.chat.id, state, ctx);
      await ctx.reply("A spam message was removed.");
    } catch {
      await ctx.reply("I couldn't remove that message. Check that I can delete messages.");
    }
  } catch {
    // Do not retain message content or emit errors for ordinary group chat.
  }
});

export default composer;
