import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { now } from "../clock.js";
import { getGroup, saveGroup } from "../guardian-store.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { WEEK_MS, formatOverview, requireAdmin } from "../guardian-shared.js";

registerMainMenuItem({ label: "Manage group", data: "guardian:admin", order: 10 });
registerMainMenuItem({ label: "View moderation log", data: "guardian:log", order: 20 });
registerMainMenuItem({ label: "View weekly overview", data: "guardian:overview", order: 30 });

const composer = new Composer<Ctx>();

const back = inlineKeyboard([[inlineButton("Back to menu", "menu:main")]]);
const adminMenu = inlineKeyboard([
  [inlineButton("Set welcome", "guardian:welcome"), inlineButton("Set rules", "guardian:rules")],
  [inlineButton("Set auto-actions", "guardian:auto")],
  [inlineButton("Back to menu", "menu:main")],
]);

function textAfterCommand(ctx: Ctx): string {
  return (ctx.message?.text ?? "").replace(/^\/\S+\s*/, "").trim();
}

async function showLog(ctx: Ctx): Promise<void> {
  if (!ctx.chat || !(await requireAdmin(ctx))) return;
  try {
    const group = await getGroup(ctx.chat.id, ctx);
    const entries = group.logs.slice(-8).reverse();
    const text = entries.length === 0
      ? "No moderation actions yet — actions will appear here."
      : `Latest moderation actions\n${entries.map((entry) => `${entry.action_type.replace("_", " ")} — ${entry.reason}`).join("\n")}`;
    if (ctx.callbackQuery) await ctx.editMessageText(text, { reply_markup: back });
    else await ctx.reply(text, { reply_markup: back });
  } catch {
    await ctx.reply("Moderation storage isn't set up yet. Ask the owner to finish setup.");
  }
}

async function showOverview(ctx: Ctx): Promise<void> {
  if (!ctx.chat || !(await requireAdmin(ctx))) return;
  try {
    const group = await getGroup(ctx.chat.id, ctx);
    const text = formatOverview(group.logs, now() - WEEK_MS);
    if (ctx.callbackQuery) await ctx.editMessageText(text, { reply_markup: back });
    else await ctx.reply(text, { reply_markup: back });
  } catch {
    await ctx.reply("Moderation storage isn't set up yet. Ask the owner to finish setup.");
  }
}

composer.callbackQuery("guardian:admin", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await requireAdmin(ctx))) return;
  await ctx.editMessageText("Choose what you want to configure.", { reply_markup: adminMenu });
});
composer.callbackQuery("guardian:log", async (ctx) => { await ctx.answerCallbackQuery(); await showLog(ctx); });
composer.callbackQuery("guardian:overview", async (ctx) => { await ctx.answerCallbackQuery(); await showOverview(ctx); });

composer.callbackQuery(/^guardian:(welcome|rules|auto)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await requireAdmin(ctx))) return;
  const action = ctx.match[1];
  const session = ctx.session as { setting?: "welcome" | "rules" | "auto"; settingExpiresAt?: number };
  session.setting = action === "welcome" ? "welcome" : action === "rules" ? "rules" : "auto";
  session.settingExpiresAt = now() + 5 * 60 * 1000;
  const prompt = action === "welcome"
    ? "Send the welcome message new members should see."
    : action === "rules"
      ? "Send the rules members should follow."
      : "Send the flood limit as messages/window, for example 10/10s.";
  await ctx.reply(prompt, { reply_markup: { force_reply: true, input_field_placeholder: "Type the setting…" } });
});

composer.command("setwelcome", async (ctx) => {
  if (!(await requireAdmin(ctx))) return;
  const value = textAfterCommand(ctx);
  if (!value) { await ctx.reply("Add the welcome message after /setwelcome."); return; }
  try {
    const state = await getGroup(ctx.chat!.id, ctx);
    state.config.welcome_text = value.slice(0, 1000);
    await saveGroup(ctx.chat!.id, state, ctx);
    await ctx.reply("Welcome message updated.");
  } catch { await ctx.reply("Moderation storage isn't set up yet. Ask the owner to finish setup."); }
});

composer.command("setrules", async (ctx) => {
  if (!(await requireAdmin(ctx))) return;
  const value = textAfterCommand(ctx);
  if (!value) { await ctx.reply("Add the rules after /setrules."); return; }
  try {
    const state = await getGroup(ctx.chat!.id, ctx);
    state.config.rules_text = value.slice(0, 2000);
    await saveGroup(ctx.chat!.id, state, ctx);
    await ctx.reply("Group rules updated.");
  } catch { await ctx.reply("Moderation storage isn't set up yet. Ask the owner to finish setup."); }
});

async function setAutoActions(ctx: Ctx, value: string): Promise<void> {
  const match = /^(\d{1,3})\s*\/\s*(\d{1,3})s$/i.exec(value);
  if (!match || Number(match[1]) < 2 || Number(match[2]) < 1) {
    await ctx.reply("Use messages/window, for example 10/10s.");
    return;
  }
  try {
    const state = await getGroup(ctx.chat!.id, ctx);
    state.config.autoaction_thresholds = { floodMessages: Number(match[1]), floodWindowMs: Number(match[2]) * 1000 };
    await saveGroup(ctx.chat!.id, state, ctx);
    await ctx.reply("Auto-action threshold updated.");
  } catch { await ctx.reply("Moderation storage isn't set up yet. Ask the owner to finish setup."); }
}

composer.command("setautoactions", async (ctx) => {
  if (!(await requireAdmin(ctx))) return;
  await setAutoActions(ctx, textAfterCommand(ctx));
});
composer.command("log", async (ctx) => { await showLog(ctx); });
composer.command("overview", async (ctx) => { await showOverview(ctx); });

composer.on("message:text", async (ctx, next) => {
  const session = ctx.session as { setting?: "welcome" | "rules" | "auto"; settingExpiresAt?: number };
  const setting = session.setting;
  if (!setting || !ctx.chat || !ctx.message?.text || ctx.message.text.startsWith("/")) return next();
  if ((session.settingExpiresAt ?? 0) <= now()) {
    session.setting = undefined;
    session.settingExpiresAt = undefined;
    await ctx.reply("That setup step expired. Open Manage group to try again.");
    return;
  }
  if (!(await requireAdmin(ctx))) { session.setting = undefined; session.settingExpiresAt = undefined; return; }
  const value = ctx.message.text.trim();
  if (!value) { await ctx.reply("Send a value to update this setting."); return; }
  if (setting === "auto") await setAutoActions(ctx, value);
  else {
    try {
      const state = await getGroup(ctx.chat.id, ctx);
      state.config[setting === "welcome" ? "welcome_text" : "rules_text"] = value.slice(0, setting === "welcome" ? 1000 : 2000);
      await saveGroup(ctx.chat.id, state, ctx);
      await ctx.reply(setting === "welcome" ? "Welcome message updated." : "Group rules updated.");
    } catch { await ctx.reply("Moderation storage isn't set up yet. Ask the owner to finish setup."); }
  }
  session.setting = undefined;
  session.settingExpiresAt = undefined;
});

export default composer;
