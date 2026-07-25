import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { commandTail, logAction, repliedUserId, requireAdmin } from "../guardian-shared.js";

const composer = new Composer<Ctx>();

composer.command("kick", async (ctx) => {
  if (!(await requireAdmin(ctx))) return;
  const target = repliedUserId(ctx);
  if (!target || !ctx.chat) {
    await ctx.reply("Reply to the member you want to remove, then send /kick with an optional reason.");
    return;
  }
  try {
    await ctx.api.banChatMember(ctx.chat.id, target);
  } catch {
    await ctx.reply("Couldn't remove that member. Check that I can ban members.");
    return;
  }
  const reason = commandTail(ctx) || "No reason provided.";
  if (await logAction(ctx, { action_type: "kick", user_id: target, reason })) {
    await ctx.reply(`A member was removed. Reason: ${reason}`);
  }
});

export default composer;
