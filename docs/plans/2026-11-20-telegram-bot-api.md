# Telegram provider and Bot API

Accepted for the fork's 4.0 development line on 2026-11-20.

AutoBangumi currently knows two Telegram URLs. Episode sends, system events and the settings test each construct their own payload. The shared form helpers discard Telegram's error envelope and can retry a POST whose outcome is unknown. The settings API also duplicates the provider model when testing a draft. These boundaries make adding an option such as a topic ID or an inline keyboard a change in several places.

## Protocol and ownership

Use one method-neutral Telegram client. A method name selects a single path segment under the saved bot's endpoint. Telegram validates method-specific fields, combination rules and chat permissions. JSON preserves objects, arrays, booleans and large IDs. Multipart carries binary parts and references such as `attach://cover` in nested media. Return the whole Bot API envelope for explicit calls, including scalar results, error descriptions and response parameters. A metadata catalog can describe methods to clients without gating execution on its release date. Telegram published Bot API 10.4 on November 9. [Bot API requests](https://core.telegram.org/bots/api#making-requests) · [File inputs](https://core.telegram.org/bots/api#sending-files) · [Change history](https://core.telegram.org/bots/api-changelog)

| Owner | Contract |
| --- | --- |
| Configuration | Keep the existing token, chat ID, template and environment expansion. A nested Telegram configuration describes delivery options and optional episode and event method calls. Other channels retain their own settings and plugin fields. |
| Telegram client | Construct production, test and self-hosted URLs, send one request, decode the envelope, distinguish a Telegram rejection from a transport failure, and retrieve file bytes. Reuse AutoBangumi's proxy-aware HTTP stack. |
| Telegram notification provider | Preserve existing message formatting, event hooks and the default source poster → cached upload → text sequence for a rejected photo. Decide delivery policy here. A custom method receives only the parameters the operator supplies. |
| Authenticated notification API | Resolve a saved Telegram provider by its original configuration index. Expose explicit method calls, uploads and file retrieval with server-held credentials. The existing draft and saved provider tests continue to work. |
| Update consumer | Own polling offsets or receive Telegram webhook POSTs at the configured URL. Polling, registering a webhook and changing pending updates require explicit calls. The choice of hosting an additional receiver inside AutoBangumi is open. |
| UI teammate | Own the settings editor, method discovery and interaction design. Consume the backend contract and its examples at handoff. |

## Decisions

- Use a wire client over the existing HTTP dependency. An SDK with a method per endpoint would put releases of a second API model on the feature's critical path. A method-neutral contract also admits new Telegram types before the next AutoBangumi release.
- Keep the chat ID as a default for ordinary notifications. Telegram also has methods such as `getMe`, `answerCallbackQuery` and `getUpdates` that have no chat destination. Avoid adding defaults to explicit calls.
- Constrain the endpoint to a configured HTTP(S) Bot API service. Never follow redirects carrying bot credentials, log token-bearing URLs or echo exception text from a transport. Stream binary transfers. Local-server absolute paths belong to that server. Telegram documents different hosted and local transfer limits. [Local Bot API](https://core.telegram.org/bots/api#using-a-local-bot-api-server) · [Telegram server](https://github.com/tdlib/telegram-bot-api)
- Surface `retry_after` and `migrate_to_chat_id` so the caller can act. A timeout can happen after Telegram applies a mutation. Retrying it or sending a substitute can duplicate a message, payment or moderation action. Do not replay an operation with an unknown outcome. [ResponseParameters](https://core.telegram.org/bots/api#responseparameters) · [HTTP retry semantics](https://www.rfc-editor.org/rfc/rfc9110#section-9.2.2)
- Preserve the update and webhook objects intact. The caller chooses allowed updates, the polling offset and webhook delivery settings. Whichever service receives webhooks authenticates Telegram's secret header and acknowledges delivery after accepting the update. [Getting updates](https://core.telegram.org/bots/api#getting-updates) · [Webhook guide](https://core.telegram.org/bots/webhooks)

## Delivery and verification

Work on a topic branch in the fork. Publish the design, transport, provider integration and HTTP contract as independently reviewable changes. Exercise the normal application routes, legacy settings, masking, wire encoding and cleanup on error. Use a mock Telegram transport for offline regression coverage, including methods introduced after the checked catalog. A live bot test requires a separately provisioned bot and destination. [Git workflows](https://git-scm.com/docs/gitworkflows) · [Fork workflow](https://cli.github.com/manual/gh_repo_clone)
