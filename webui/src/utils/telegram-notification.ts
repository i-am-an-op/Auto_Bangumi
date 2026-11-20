import type {
  JsonObject,
  NotificationProviderConfig,
  TelegramParseMode,
  TelegramSettings,
} from '#/config';

export const TELEGRAM_PARSE_MODES = ['HTML', 'MarkdownV2', 'Markdown'] as const;

export const TELEGRAM_RESERVED_PARAMETER_KEYS = new Set([
  'chat_id',
  'text',
  'caption',
  'photo',
  'method',
  'include_poster',
  'message_thread_id',
  'disable_notification',
  'protect_content',
  'parse_mode',
  'reply_markup',
  'text_parameters',
  'photo_parameters',
]);

export type TriStateValue = 'default' | 'true' | 'false';
export type TelegramParseModeChoice = 'none' | TelegramParseMode;

export interface TelegramDraftForm {
  include_poster: boolean;
  message_thread_id: string;
  parse_mode: TelegramParseModeChoice;
  disable_notification: TriStateValue;
  protect_content: TriStateValue;
  reply_markup_text: string;
  text_parameters_text: string;
  photo_parameters_text: string;
}

export interface TelegramJsonSnapshot<T> {
  initialText: string;
  value: T;
}

export interface TelegramJsonFieldSnapshots {
  reply_markup: TelegramJsonSnapshot<JsonObject | null>;
  text_parameters: TelegramJsonSnapshot<JsonObject>;
  photo_parameters: TelegramJsonSnapshot<JsonObject>;
}

export interface TelegramDraftState {
  draft: TelegramDraftForm;
  snapshots: TelegramJsonFieldSnapshots;
  hasAdvancedValues: boolean;
}

export type TelegramValidationError =
  | { code: 'invalid_thread_id' }
  | { code: 'invalid_json' }
  | { code: 'expected_json_object' }
  | { code: 'unrepresentable_number'; value: string }
  | { code: 'reserved_keys'; keys: string[] };

export interface TelegramDraftValidationErrors {
  message_thread_id?: TelegramValidationError;
  reply_markup?: TelegramValidationError;
  text_parameters?: TelegramValidationError;
  photo_parameters?: TelegramValidationError;
}

export type TelegramBuildResult =
  | { ok: true; value: Required<TelegramSettings> }
  | { ok: false; errors: TelegramDraftValidationErrors };

export interface ApplyTelegramDraftOptions {
  hadTelegram: boolean;
  hadTemplate: boolean;
  isNew: boolean;
}

export function cloneProviderConfig<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

export function isTelegramProvider(
  provider: { type?: string } | null | undefined
): boolean {
  return provider?.type?.toLowerCase() === 'telegram';
}

export function createDefaultTelegramSettings(): Required<TelegramSettings> {
  return {
    include_poster: true,
    message_thread_id: null,
    disable_notification: null,
    protect_content: null,
    parse_mode: null,
    reply_markup: null,
    text_parameters: {},
    photo_parameters: {},
  };
}

export function triStateFromBool(
  value: boolean | null | undefined
): TriStateValue {
  if (value === true) return 'true';
  if (value === false) return 'false';
  return 'default';
}

export function triStateToBool(value: TriStateValue): boolean | null {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

function isPlainJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatJsonObject(
  value: JsonObject | null | undefined,
  omitEmpty: boolean
): string {
  if (!isPlainJsonObject(value)) return '';
  if (omitEmpty && Object.keys(value).length === 0) return '';
  return JSON.stringify(value, null, 2);
}

export function createTelegramDraft(
  settings?: TelegramSettings | null
): TelegramDraftState {
  const replyMarkup = isPlainJsonObject(settings?.reply_markup)
    ? cloneProviderConfig(settings.reply_markup)
    : null;
  const textParameters = isPlainJsonObject(settings?.text_parameters)
    ? cloneProviderConfig(settings.text_parameters)
    : {};
  const photoParameters = isPlainJsonObject(settings?.photo_parameters)
    ? cloneProviderConfig(settings.photo_parameters)
    : {};

  const replyMarkupText = formatJsonObject(replyMarkup, false);
  const textParametersText = formatJsonObject(textParameters, true);
  const photoParametersText = formatJsonObject(photoParameters, true);

  const parseMode: TelegramParseModeChoice =
    settings?.parse_mode &&
    (TELEGRAM_PARSE_MODES as readonly string[]).includes(settings.parse_mode)
      ? settings.parse_mode
      : 'none';

  return {
    draft: {
      include_poster: settings?.include_poster ?? true,
      message_thread_id:
        settings?.message_thread_id !== null &&
        settings?.message_thread_id !== undefined
          ? String(settings.message_thread_id)
          : '',
      parse_mode: parseMode,
      disable_notification: triStateFromBool(settings?.disable_notification),
      protect_content: triStateFromBool(settings?.protect_content),
      reply_markup_text: replyMarkupText,
      text_parameters_text: textParametersText,
      photo_parameters_text: photoParametersText,
    },
    snapshots: {
      reply_markup: { initialText: replyMarkupText, value: replyMarkup },
      text_parameters: {
        initialText: textParametersText,
        value: textParameters,
      },
      photo_parameters: {
        initialText: photoParametersText,
        value: photoParameters,
      },
    },
    hasAdvancedValues: Boolean(
      replyMarkup !== null ||
      Object.keys(textParameters).length > 0 ||
      Object.keys(photoParameters).length > 0
    ),
  };
}

interface CanonicalDecimal {
  negative: boolean;
  coeff: string;
  exp10: bigint;
}

function canonicalDecimal(raw: string): CanonicalDecimal | null {
  const match = /^(-)?(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(raw);
  if (!match) return null;
  const negative = Boolean(match[1]);
  const intPart = match[2];
  const fracPart = match[3] ?? '';
  const expPart = match[4] ? BigInt(match[4]) : 0n;

  const combined = intPart + fracPart;
  const strippedLeading = combined.replace(/^0+/, '');
  if (strippedLeading === '') {
    return { negative: false, coeff: '0', exp10: 0n };
  }
  const trimmedTrailing = strippedLeading.replace(/0+$/, '');
  const trailingZeros = strippedLeading.length - trimmedTrailing.length;
  const exp10 = expPart - BigInt(fracPart.length) + BigInt(trailingZeros);
  return { negative, coeff: trimmedTrailing, exp10 };
}

function extractJsonNumberTokens(jsonText: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  const len = jsonText.length;
  while (i < len) {
    const ch = jsonText[i];
    if (ch === '"') {
      i += 1;
      while (i < len) {
        if (jsonText[i] === '\\') {
          i += 2;
        } else if (jsonText[i] === '"') {
          i += 1;
          break;
        } else {
          i += 1;
        }
      }
      continue;
    }
    if (ch === '-' || (ch >= '0' && ch <= '9')) {
      const start = i;
      i += 1;
      while (i < len && /[0-9eE.+-]/.test(jsonText[i])) {
        i += 1;
      }
      tokens.push(jsonText.slice(start, i));
      continue;
    }
    i += 1;
  }
  return tokens;
}

function findUnrepresentableJsonNumber(jsonText: string): string | null {
  for (const raw of extractJsonNumberTokens(jsonText)) {
    const num = Number(raw);
    if (!Number.isFinite(num)) {
      return raw;
    }
    if (/^-?\d+$/.test(raw) && !Number.isSafeInteger(num)) {
      return raw;
    }
    const source = canonicalDecimal(raw);
    const serialized = canonicalDecimal(String(num));
    if (
      !source ||
      !serialized ||
      source.negative !== serialized.negative ||
      source.coeff !== serialized.coeff ||
      source.exp10 !== serialized.exp10
    ) {
      return raw;
    }
  }
  return null;
}

function findReservedKeys(obj: JsonObject): string[] {
  return Object.keys(obj)
    .filter((key) => TELEGRAM_RESERVED_PARAMETER_KEYS.has(key))
    .sort();
}

function parseJsonObjectField(
  rawText: string,
  snapshot: TelegramJsonSnapshot<JsonObject | null>,
  options: { allowNull: boolean; checkReserved: boolean }
):
  | { ok: true; value: JsonObject | null }
  | { ok: false; error: TelegramValidationError } {
  if (rawText === snapshot.initialText) {
    const cloned =
      snapshot.value === null
        ? options.allowNull
          ? null
          : {}
        : cloneProviderConfig(snapshot.value);
    if (options.checkReserved && cloned !== null) {
      const conflicts = findReservedKeys(cloned);
      if (conflicts.length > 0) {
        return { ok: false, error: { code: 'reserved_keys', keys: conflicts } };
      }
    }
    return { ok: true, value: cloned };
  }

  const trimmed = rawText.trim();
  if (trimmed === '') {
    return { ok: true, value: options.allowNull ? null : {} };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ok: false, error: { code: 'invalid_json' } };
  }

  if (!isPlainJsonObject(parsed)) {
    return { ok: false, error: { code: 'expected_json_object' } };
  }

  const unrepresentable = findUnrepresentableJsonNumber(trimmed);
  if (unrepresentable !== null) {
    return {
      ok: false,
      error: { code: 'unrepresentable_number', value: unrepresentable },
    };
  }

  if (options.checkReserved) {
    const conflicts = findReservedKeys(parsed);
    if (conflicts.length > 0) {
      return { ok: false, error: { code: 'reserved_keys', keys: conflicts } };
    }
  }

  return { ok: true, value: parsed };
}

export function buildTelegramSettings(
  draft: TelegramDraftForm,
  snapshots: TelegramJsonFieldSnapshots
): TelegramBuildResult {
  const errors: TelegramDraftValidationErrors = {};

  const rawThread = String(draft.message_thread_id ?? '').trim();
  let messageThreadId: number | null = null;
  if (rawThread !== '') {
    if (/^[1-9]\d*$/.test(rawThread)) {
      const parsed = Number(rawThread);
      if (Number.isSafeInteger(parsed) && parsed > 0) {
        messageThreadId = parsed;
      } else {
        errors.message_thread_id = { code: 'invalid_thread_id' };
      }
    } else {
      errors.message_thread_id = { code: 'invalid_thread_id' };
    }
  }

  const replyMarkupResult = parseJsonObjectField(
    draft.reply_markup_text,
    snapshots.reply_markup,
    { allowNull: true, checkReserved: false }
  );
  if (!replyMarkupResult.ok) {
    errors.reply_markup = replyMarkupResult.error;
  }

  const textParamsResult = parseJsonObjectField(
    draft.text_parameters_text,
    snapshots.text_parameters,
    { allowNull: false, checkReserved: true }
  );
  if (!textParamsResult.ok) {
    errors.text_parameters = textParamsResult.error;
  }

  const photoParamsResult = parseJsonObjectField(
    draft.photo_parameters_text,
    snapshots.photo_parameters,
    { allowNull: false, checkReserved: true }
  );
  if (!photoParamsResult.ok) {
    errors.photo_parameters = photoParamsResult.error;
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      include_poster: Boolean(draft.include_poster),
      message_thread_id: messageThreadId,
      disable_notification: triStateToBool(draft.disable_notification),
      protect_content: triStateToBool(draft.protect_content),
      parse_mode: draft.parse_mode === 'none' ? null : draft.parse_mode,
      reply_markup: replyMarkupResult.ok ? replyMarkupResult.value : null,
      text_parameters:
        textParamsResult.ok && textParamsResult.value !== null
          ? textParamsResult.value
          : {},
      photo_parameters:
        photoParamsResult.ok && photoParamsResult.value !== null
          ? photoParamsResult.value
          : {},
    },
  };
}

export function isDefaultTelegramSettings(settings: TelegramSettings): boolean {
  return (
    JSON.stringify(settings) === JSON.stringify(createDefaultTelegramSettings())
  );
}

export function applyTelegramDraftToProvider(
  provider: NotificationProviderConfig,
  settings: Required<TelegramSettings>,
  options: ApplyTelegramDraftOptions
): NotificationProviderConfig {
  const next = cloneProviderConfig(provider);
  if (typeof next.template === 'string' && next.template.trim() === '') {
    if (options.hadTemplate) {
      next.template = null;
    } else {
      delete next.template;
    }
  }
  if (
    options.isNew ||
    options.hadTelegram ||
    !isDefaultTelegramSettings(settings)
  ) {
    next.telegram = settings;
  } else {
    delete next.telegram;
  }
  return next;
}
