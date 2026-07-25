import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { now } from "../clock.js";
import { commandTail, logAction, repliedUserId, requireAdmin } from "../guardian-shared.js";

const composer = new Composer<Ctx>();

composer.command("mute", async (ctx) => {
  if (!(await requireAdmin(ctx))) return;
  const target = repliedUserId(ctx);
  if (!target || !ctx.chat) {
    await ctx.reply("Reply to the member you want to mute, then send /mute 10m with an optional reason.");
    return;
  }
  const tail = commandTail(ctx);
  const match = /^(\d+)(m|h|d)(?:\s+(.*))?$/i.exec(tail);
  if (!match) {
    await ctx.reply("Add a duration such as 10m, 2h, or 1d after /mute.");
    return;
  }
  const amount = Number(match[1]);
  const multiplier = match[2].toLowerCase() === "m" ? 60 : match[2].toLowerCase() === "h" ? 3600 : 86400;
  const until = Math.floor(now() / 1000) + amount * multiplier;
  try {
    await ctx.api.restrictChatMember(ctx.chat.id, target, { can_send_messages: false }, { until_date: until });
  } catch {
    await ctx.reply("Couldn't mute that member. Check that I can restrict members.");
    return;
  }
  const reason = match[3]?.trim() || "No reason provided.";
  if (await logAction(ctx, { action_type: "mute", user_id: target, reason })) {
    await ctx.reply(`A member was muted. Reason: ${reason}`);
  }
});

export default composer;
