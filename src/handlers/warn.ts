import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { commandTail, logAction, repliedUserId, requireAdmin } from "../guardian-shared.js";

const composer = new Composer<Ctx>();

composer.command("warn", async (ctx) => {
  if (!(await requireAdmin(ctx))) return;
  const target = repliedUserId(ctx);
  if (!target) {
    await ctx.reply("Reply to the member you want to warn, then send /warn with an optional reason.");
    return;
  }
  const reason = commandTail(ctx) || "No reason provided.";
  if (await logAction(ctx, { action_type: "warn", user_id: target, reason })) {
    await ctx.reply(`A member was warned. Reason: ${reason}`);
  }
});

export default composer;
