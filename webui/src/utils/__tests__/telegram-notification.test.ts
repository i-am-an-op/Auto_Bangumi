import { describe, expect, it } from 'vitest';
import type { NotificationProviderConfig } from '#/config';
import {
  applyTelegramDraftToProvider,
  buildTelegramSettings,
  createDefaultTelegramSettings,
  createTelegramDraft,
} from '@/utils/telegram-notification';

describe('telegram-notification helpers', () => {
  it('should apply documented defaults for a legacy row without telegram settings', () => {
    const state = createTelegramDraft(undefined);
    expect(state.hasAdvancedValues).toBe(false);
    expect(state.draft).toEqual({
      include_poster: true,
      message_thread_id: '',
      parse_mode: 'none',
      disable_notification: 'default',
      protect_content: 'default',
      reply_markup_text: '',
      text_parameters_text: '',
      photo_parameters_text: '',
    });

    const built = buildTelegramSettings(state.draft, state.snapshots);
    expect(built).toEqual({
      ok: true,
      value: createDefaultTelegramSettings(),
    });
  });

  it('should preserve explicit false values separately from null defaults', () => {
    const state = createTelegramDraft({
      include_poster: false,
      message_thread_id: null,
      disable_notification: false,
      protect_content: false,
      parse_mode: null,
      reply_markup: null,
      text_parameters: {},
      photo_parameters: {},
    });
    expect(state.draft.include_poster).toBe(false);
    expect(state.draft.disable_notification).toBe('false');
    expect(state.draft.protect_content).toBe('false');

    const built = buildTelegramSettings(state.draft, state.snapshots);
    expect(built).toEqual({
      ok: true,
      value: {
        include_poster: false,
        message_thread_id: null,
        disable_notification: false,
        protect_content: false,
        parse_mode: null,
        reply_markup: null,
        text_parameters: {},
        photo_parameters: {},
      },
    });

    // Resetting tri-state options back to default produces null
    state.draft.disable_notification = 'default';
    state.draft.protect_content = 'default';
    const reset = buildTelegramSettings(state.draft, state.snapshots);
    expect(reset).toEqual({
      ok: true,
      value: expect.objectContaining({
        include_poster: false,
        disable_notification: null,
        protect_content: null,
      }),
    });
  });

  it('should validate positive integer topic IDs and allow empty', () => {
    const state = createTelegramDraft();
    state.draft.message_thread_id = ' 42 ';
    const valid = buildTelegramSettings(state.draft, state.snapshots);
    expect(valid).toEqual({
      ok: true,
      value: expect.objectContaining({ message_thread_id: 42 }),
    });

    for (const invalid of ['0', '-5', '1.5', 'abc', '9007199254740993']) {
      state.draft.message_thread_id = invalid;
      const result = buildTelegramSettings(state.draft, state.snapshots);
      expect(result).toEqual({
        ok: false,
        errors: {
          message_thread_id: { code: 'invalid_thread_id' },
        },
      });
    }
  });

  it('should preserve nested objects, arrays, booleans, numbers and masked secrets across unrelated edits', () => {
    const original = {
      include_poster: true,
      message_thread_id: 42,
      disable_notification: false,
      protect_content: true,
      parse_mode: 'HTML' as const,
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Open library', url: 'https://library.example.org' }],
        ],
      },
      text_parameters: {
        link_preview_options: { is_disabled: true, show_above_text: false },
        retries: 2,
        future_options: [[{ secret_token: '********' }]],
      },
      photo_parameters: {
        has_spoiler: true,
        show_caption_above_media: false,
      },
    };
    const state = createTelegramDraft(original);
    expect(state.hasAdvancedValues).toBe(true);

    // Edit an unrelated field (topic ID)
    state.draft.message_thread_id = '99';
    const built = buildTelegramSettings(state.draft, state.snapshots);
    expect(built).toEqual({
      ok: true,
      value: {
        ...original,
        message_thread_id: 99,
      },
    });
  });

  it('should reject invalid JSON, non-object JSON, and reserved keys in method parameters', () => {
    const state = createTelegramDraft();
    state.draft.reply_markup_text = '{bad json';
    state.draft.text_parameters_text = '["not", "an", "object"]';
    state.draft.photo_parameters_text = JSON.stringify({
      has_spoiler: true,
      caption: 'override',
      method: 'sendMessage',
      parse_mode: 'HTML',
    });

    const result = buildTelegramSettings(state.draft, state.snapshots);
    expect(result).toEqual({
      ok: false,
      errors: {
        reply_markup: { code: 'invalid_json' },
        text_parameters: { code: 'expected_json_object' },
        photo_parameters: {
          code: 'reserved_keys',
          keys: ['caption', 'method', 'parse_mode'],
        },
      },
    });
  });

  it('should reject JSON numbers that lose precision or overflow to Infinity/zero', () => {
    const state = createTelegramDraft();
    for (const bad of [
      '9007199254740993',
      '-9007199254740993',
      '9007199254740992',
      '1e400',
      '-1e400',
      '1e-400',
      '0.12345678901234567890',
    ]) {
      state.draft.reply_markup_text = `{"nested": [${bad}]}`;
      state.draft.text_parameters_text = `{"value": ${bad}}`;
      state.draft.photo_parameters_text = `{"value": ${bad}}`;
      const result = buildTelegramSettings(state.draft, state.snapshots);
      expect(result).toEqual({
        ok: false,
        errors: {
          reply_markup: { code: 'unrepresentable_number', value: bad },
          text_parameters: { code: 'unrepresentable_number', value: bad },
          photo_parameters: { code: 'unrepresentable_number', value: bad },
        },
      });
    }

    // Safe integers, normal floats, and large digits inside JSON strings remain accepted
    state.draft.reply_markup_text =
      '{"inline_keyboard":[[{"text":"9007199254740993","url":"https://example.org/1e400"}]]}';
    state.draft.text_parameters_text =
      '{"safe_max": 9007199254740991, "chat_ref": -1001234567890, "ratio": 0.5, "label": "1e400"}';
    state.draft.photo_parameters_text = '{"has_spoiler": true, "count": 0}';
    const valid = buildTelegramSettings(state.draft, state.snapshots);
    expect(valid).toEqual({
      ok: true,
      value: expect.objectContaining({
        reply_markup: {
          inline_keyboard: [
            [{ text: '9007199254740993', url: 'https://example.org/1e400' }],
          ],
        },
        text_parameters: {
          safe_max: 9007199254740991,
          chat_ref: -1001234567890,
          ratio: 0.5,
          label: '1e400',
        },
        photo_parameters: { has_spoiler: true, count: 0 },
      }),
    });
  });

  it('should keep legacy provider without telegram untouched if defaults were not changed', () => {
    const legacy: NotificationProviderConfig = {
      type: 'telegram',
      enabled: true,
      token: '********',
      chat_id: '-100123',
    };
    const defaults = createDefaultTelegramSettings();
    const untouched = applyTelegramDraftToProvider(legacy, defaults, {
      hadTelegram: false,
      hadTemplate: false,
      isNew: false,
    });
    expect(untouched).toEqual(legacy);

    const edited = applyTelegramDraftToProvider(
      legacy,
      { ...defaults, include_poster: false },
      { hadTelegram: false, hadTemplate: false, isNew: false }
    );
    expect(edited.telegram?.include_poster).toBe(false);
  });

  it('should normalize cleared templates without losing original template presence', () => {
    const withNullTemplate: NotificationProviderConfig = {
      type: 'telegram',
      enabled: true,
      token: '********',
      template: '   ',
      telegram: createDefaultTelegramSettings(),
    };
    const result = applyTelegramDraftToProvider(
      withNullTemplate,
      createDefaultTelegramSettings(),
      { hadTelegram: true, hadTemplate: true, isNew: false }
    );
    expect(result.template).toBeNull();
  });
});
