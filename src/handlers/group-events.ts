import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { now } from "../clock.js";
import { getGroup, saveGroup } from "../guardian-store.js";
import { inlineButton, inlineKeyboard } from "../toolkit/index.js";
import { removeUnverifiedAt, type WorkerEnv } from "../toolkit/session/durable.js";
import { VERIFICATION_WINDOW_MS, isGroup, logAction } from "../guardian-shared.js";

const composer = new Composer<Ctx>();

async function removeExpired(ctx: Ctx): Promise<void> {
  if (!ctx.chat || !isGroup(ctx)) return;
  try {
    const state = await getGroup(ctx.chat.id, ctx);
    const expired = Object.values(state.newcomers).filter((person) => !person.verified_status && person.join_time + VERIFICATION_WINDOW_MS <= now());
    for (const person of expired) {
      try {
        await ctx.api.banChatMember(ctx.chat.id, person.user_id);
        delete state.newcomers[String(person.user_id)];
        state.logs.push({ action_type: "verification_remove", user_id: person.user_id, timestamp: now(), reason: "Verification timed out." });
      } catch {
        // The bot may have lost permission; leave the record for a later retry.
      }
    }
    await saveGroup(ctx.chat.id, state, ctx);
  } catch {
    // A later group update retries expiry work if storage is temporarily unavailable.
  }
}

composer.on("message:new_chat_members", async (ctx) => {
  if (!ctx.chat || !isGroup(ctx)) return;
  await removeExpired(ctx);
  const members = ctx.message?.new_chat_members ?? [];
  try {
    const state = await getGroup(ctx.chat.id, ctx);
    for (const member of members) {
      if (member.is_bot) continue;
      state.newcomers[String(member.id)] = { user_id: member.id, join_time: now(), verified_status: false };
      try { await ctx.api.restrictChatMember(ctx.chat.id, member.id, { can_send_messages: false }); } catch { /* welcome still explains verification */ }
    }
    const session = ctx.session as { verificationTokens?: Record<string, { token_id: string; user_id: number; expiry_time: number }> };
    session.verificationTokens ??= {};
    for (const member of members) {
      if (!member.is_bot) {
        session.verificationTokens[String(member.id)] = {
          token_id: `${member.id}:${state.newcomers[String(member.id)].join_time}`,
          user_id: member.id,
          expiry_time: state.newcomers[String(member.id)].join_time + VERIFICATION_WINDOW_MS,
        };
      }
    }
    await saveGroup(ctx.chat.id, state, ctx);
    if (members.some((member) => !member.is_bot)) {
      await ctx.reply(state.config.welcome_text, { reply_markup: inlineKeyboard([[inlineButton("I'm human", "verify:user")]]) });
      const env = (ctx as Ctx & { env?: WorkerEnv }).env;
      if (env) {
        for (const member of members) {
          if (!member.is_bot) void removeUnverifiedAt(env, ctx.chat.id, member.id, now() + VERIFICATION_WINDOW_MS);
        }
      }
      scheduleVerificationSweep(ctx);
    }
  } catch {
    await ctx.reply("Verification isn't set up yet. Ask a group admin to finish storage setup.");
  }
});

// Incoming group activity is also an expiry retry point after a restart.
composer.on("message", async (ctx, next) => {
  await removeExpired(ctx);
  await next();
});

// A timer handles the normal one-minute path; durable expiry checks above cover
// restarts and timer suspension without keeping a second data store in memory.
export function scheduleVerificationSweep(ctx: Ctx): void {
  if (!ctx.chat || !isGroup(ctx)) return;
  const chatId = ctx.chat.id;
  setTimeout(() => {
    void (async () => {
      try {
        const state = await getGroup(chatId, ctx);
        for (const person of Object.values(state.newcomers)) {
          if (!person.verified_status && person.join_time + VERIFICATION_WINDOW_MS <= now()) {
            try {
              await ctx.api.banChatMember(chatId, person.user_id);
              delete state.newcomers[String(person.user_id)];
              state.logs.push({ action_type: "verification_remove", user_id: person.user_id, timestamp: now(), reason: "Verification timed out." });
            } catch { /* retry on the next group update */ }
          }
        }
        await saveGroup(chatId, state, ctx);
      } catch { /* durable retry remains available */ }
    })();
  }, VERIFICATION_WINDOW_MS);
}

export default composer;
