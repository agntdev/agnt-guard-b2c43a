# GroupGuardian — Bot specification

**Archetype:** community

**Voice:** professional and concise — write every user-facing message, button label, error, and empty state in this voice.

Automated Telegram group moderation bot with configurable anti-spam rules, verification workflows, admin controls, and moderation analytics. Enforces rules through verification buttons, spam detection, and admin-triggered actions while maintaining transparency through logs and metrics.

> This is the complete contract for the bot. Implement EVERY entry point, flow, feature, integration, and edge case below. The completeness review checks the bot against this document after each build pass.

## Primary audience

- Telegram group owners
- Community moderators

## Success criteria

- Automated removal of unverified users within 1 minute
- Real-time spam detection for new accounts
- Admin-triggered moderation actions with public explanations
- Weekly moderation overview summaries

## Entry points

Every feature must be reachable from the bot's command/button surface (button-first; only /start and /help are slash commands).

- **/start** (command, actor: user, command: /start) — Open moderation bot main menu
- **/warn** (command, actor: admin, command: /warn) — Issue warning to user with optional reason
- **/mute** (command, actor: admin, command: /mute) — Mute user for specified duration
- **I'm human** (button, actor: user, callback: verify:user) — Verification button in welcome message

## Flows

### Join verification
_Trigger:_ User joins group

1. Send welcome message with verification button
2. Wait 1 minute for verification
3. Auto-remove unverified users

_Data touched:_ Newcomer, Verification token

### Spam detection
_Trigger:_ Message posted by new account (<24h)

1. Check for links
2. Auto-delete if spam threshold met

_Data touched:_ Spam detection log

### Admin moderation
_Trigger:_ /mute or /kick command

1. Confirm admin privileges
2. Apply moderation action
3. Log action with reason

_Data touched:_ Moderation log

## Data entities

Durable data (must survive a restart) uses the toolkit's persistent store, never in-memory maps.

- **Newcomer** _(retention: persistent)_ — User who joined and needs verification
  - fields: user_id, join_time, verified_status
- **Verification token** _(retention: session)_ — Single-use verification button for new users
  - fields: token_id, user_id, expiry_time
- **Moderation log** _(retention: persistent)_ — History of moderation actions
  - fields: action_type, user_id, timestamp, reason
- **Rules configuration** _(retention: persistent)_ — Editable group rules and welcome message
  - fields: welcome_text, rules_text, autoaction_thresholds

## Integrations

- **Telegram** (required) — Bot API messaging and group moderation
Call external APIs against their real contract (correct endpoints, ids, params); credentials from env. Do not fake responses.

## Owner controls

- /setwelcome
- /setrules
- /setautoactions
- /log
- /overview

## Notifications

- Immediate incident alerts for auto-moderation actions
- Weekly summary of moderation statistics

## Permissions & privacy

- Only stores user IDs and moderation logs
- No personal message content stored
- Admins must comply with Telegram's terms when using moderation powers

## Edge cases

- User disconnects during verification window
- Multiple spam triggers within 10 seconds
- Admin command issued without reason parameter

## Required tests

- End-to-end verification flow with timeout handling
- Spam detection accuracy with new accounts
- Admin command permissions validation

## Assumptions

- Verification timeout is 1 minute
- Spam detection uses 24-hour account age and link checks
- Medium flood threshold: 10 messages/10s
