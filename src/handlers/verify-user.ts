import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { now } from "../clock.js";
import { getGroup, saveGroup } from "../guardian-store.js";
import { VERIFICATION_WINDOW_MS, isGroup } from "../guardian-shared.js";

const composer = new Composer<Ctx>();

composer.callbackQuery("verify:user", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!ctx.chat || !ctx.from || !isGroup(ctx)) {
    await ctx.reply("Open this button in the group where you joined.");
    return;
  }
  try {
    const state = await getGroup(ctx.chat.id, ctx);
    const newcomer = state.newcomers[String(ctx.from.id)];
    if (!newcomer || newcomer.verified_status) {
      await ctx.reply("Your verification request isn't active.");
      return;
    }
    if (newcomer.join_time + VERIFICATION_WINDOW_MS <= now()) {
      try { await ctx.api.banChatMember(ctx.chat.id, newcomer.user_id); } catch { /* show the expiry state either way */ }
      delete state.newcomers[String(ctx.from.id)];
      const session = ctx.session as { verificationTokens?: Record<string, { token_id: string; user_id: number; expiry_time: number }> };
      delete session.verificationTokens?.[String(ctx.from.id)];
      await saveGroup(ctx.chat.id, state, ctx);
      await ctx.reply("Your verification window has expired. Ask an admin to invite you again.");
      return;
    }
    newcomer.verified_status = true;
    const session = ctx.session as { verificationTokens?: Record<string, { token_id: string; user_id: number; expiry_time: number }> };
    delete session.verificationTokens?.[String(ctx.from.id)];
    await saveGroup(ctx.chat.id, state, ctx);
    try { await ctx.api.restrictChatMember(ctx.chat.id, newcomer.user_id, { can_send_messages: true }); } catch { /* verification is still recorded */ }
    await ctx.editMessageText("You're verified. Welcome to the group.");
  } catch {
    await ctx.reply("Verification isn't set up yet. Ask a group admin to finish storage setup.");
  }
});

export default composer;
