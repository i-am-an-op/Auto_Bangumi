# Telegram notification settings handoff

The built-in Telegram provider sends episode notifications, system events and test messages. An episode can use a captioned poster or plain text. System events and tests use text. All three use the destination on the provider row.

## Provider settings

This example sends episodes to topic 42 with a spoiler-covered poster and a link button. A rejected poster can fall back to a text message in the same topic.

```json
{
  "type": "telegram",
  "enabled": true,
  "token": "$TELEGRAM_BOT_TOKEN",
  "chat_id": "-1001234567890",
  "template": "<b>{{title}}</b> · S{{season}}E{{episode}}",
  "telegram": {
    "include_poster": true,
    "message_thread_id": 42,
    "parse_mode": "HTML",
    "disable_notification": false,
    "protect_content": true,
    "reply_markup": {
      "inline_keyboard": [[{"text": "Open library", "url": "https://library.example.org"}]]
    },
    "text_parameters": {"link_preview_options": {"is_disabled": true}},
    "photo_parameters": {"has_spoiler": true}
  }
}
```

| Field inside `telegram` | Contract |
| --- | --- |
| `include_poster` | Defaults to `true`. With `false`, every episode goes directly to text delivery. |
| `message_thread_id` | Positive integer for the topic. Omit or send `null` for the chat's default destination. |
| `disable_notification` | `true` sends silently. `false` allows sound. When unset, episodes and events are silent and test messages use Telegram’s default. |
| `protect_content` | Optional boolean forwarded to Telegram for text and photos. |
| `parse_mode` | `HTML`, `MarkdownV2`, `Markdown`, or `null` for plain text. The episode template supplies the markup. AutoBangumi escapes inserted display text, including episode titles, and delivers system event and test text literally. |
| `reply_markup` | Optional Telegram keyboard or reply-markup JSON object shared by text and photos. |
| `text_parameters`, `photo_parameters` | JSON objects for additional options on the respective Telegram method. Both default to `{}`. Preserve nested objects, arrays, booleans and numbers. |

A legacy row with just `token` and `chat_id` takes the existing defaults. The row’s `template` supports `{{title}}`, `{{episode}}`, `{{season}}` and `{{poster_url}}`. The provider fills `chat_id`, `text`, `caption` and `photo` from the row and notification. Additional parameter objects reject those keys, `method` and keys already declared on the settings object. Telegram validates other method-specific options. [sendMessage](https://core.telegram.org/bots/api#sendmessage) · [sendPhoto](https://core.telegram.org/bots/api#sendphoto) · [Formatting options](https://core.telegram.org/bots/api#formatting-options)

## Save and test

Use the existing authenticated settings and notification routes. A successful test means Telegram accepted a message sent to the configured destination.

| Operation | Request |
| --- | --- |
| Load or save | `GET /api/v1/config/get`, then `PATCH /api/v1/config/update` with the full edited configuration. The provider lives in `notification.providers[]`. Keep the returned `********` sentinel for an untouched token. |
| Test a saved row | `POST /api/v1/notification/test` with `{"provider_index": 0}`. Count every saved row, including disabled providers. |
| Test a new draft | `POST /api/v1/notification/test-config` with the provider object and its token. This sends the test without saving the draft. |
| Test edits to a saved row | `POST /api/v1/notification/test-config?saved_provider_index=0` with the edited provider object. The server resolves masked credentials using the original saved row. Keep that index when the draft list is reordered. |

The test response contains `success`, `message`, `message_en` and `message_zh`. Inspect `success` even on HTTP 200. Invalid settings or a mismatched saved reference produce HTTP 422. A Telegram rejection can include a reason such as an invalid topic. A transport timeout reports unconfirmed delivery and stops further sends for that notification.

## UI integration checks

The settings component is `webui/src/components/setting/config-notification.vue`. Its provider and test-request types are in `webui/types/config.ts` and `webui/src/api/notification.ts`. The backend exposes the Telegram settings schema in OpenAPI.

- Open an existing row, edit a delivery option, test it with its masked token, save and reopen it. Preserve the option, credential and topic through that sequence.
- Check a text-only episode and an episode with a poster. The topic and shared options apply to both. Photo-specific settings apply to the poster, and text-specific settings apply to a text fallback.
- Preserve an explicit `false` when editing switch settings. Use `null` or omission to request the documented default.
- Preserve additional parameter objects during unrelated edits. Surface the API’s validation or test result to the operator.
