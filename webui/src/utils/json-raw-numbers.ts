// 保留超出 JS IEEE-754 精确表示范围的 JSON 数字（例如 config.json 中已保存的
// 64 位整数 9007199254740993），使其在 GET → 内存克隆/脏值比对 → PATCH/POST
// 往返中不被静默舍入为 9007199254740992 或序列化为 null。
const NONCE = `${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
const RAW_JSON_NUMBER_KEY = `__ab_raw_json_number_${NONCE}__`;
const RAW_PLACEHOLDER_PREFIX = `__AB_RAW_NUM_BEGIN_${NONCE}__`;
const RAW_PLACEHOLDER_SUFFIX = `__AB_RAW_NUM_END_${NONCE}__`;

const JSON_NUMBER_LITERAL_RE = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const RAW_PLACEHOLDER_RE = new RegExp(
  `"${RAW_PLACEHOLDER_PREFIX}(-?(?:0|[1-9]\\d*)(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)${RAW_PLACEHOLDER_SUFFIX}"`,
  'g'
);

interface CanonicalDecimal {
  negative: boolean;
  coeff: string;
  exp10: bigint;
}

export interface JsonNumberSpan {
  start: number;
  end: number;
  raw: string;
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

export function isRepresentableJsonNumber(raw: string): boolean {
  const num = Number(raw);
  if (!Number.isFinite(num)) {
    return false;
  }
  if (/^-?\d+$/.test(raw) && !Number.isSafeInteger(num)) {
    return false;
  }
  const source = canonicalDecimal(raw);
  const serialized = canonicalDecimal(String(num));
  return Boolean(
    source &&
    serialized &&
    source.negative === serialized.negative &&
    source.coeff === serialized.coeff &&
    source.exp10 === serialized.exp10
  );
}

export function extractJsonNumberSpans(jsonText: string): JsonNumberSpan[] {
  const spans: JsonNumberSpan[] = [];
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
      spans.push({ start, end: i, raw: jsonText.slice(start, i) });
      continue;
    }
    i += 1;
  }
  return spans;
}

export function findUnrepresentableJsonNumber(jsonText: string): string | null {
  for (const span of extractJsonNumberSpans(jsonText)) {
    if (!isRepresentableJsonNumber(span.raw)) {
      return span.raw;
    }
  }
  return null;
}

export function isRawJsonNumberToken(
  value: unknown
): value is Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const raw = record[RAW_JSON_NUMBER_KEY];
  return (
    typeof raw === 'string' &&
    Object.keys(record).length === 1 &&
    JSON_NUMBER_LITERAL_RE.test(raw)
  );
}

export function getRawJsonNumberText(value: unknown): string | null {
  return isRawJsonNumberToken(value) ? value[RAW_JSON_NUMBER_KEY] : null;
}

export function hasRawJsonNumberToken(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  if (isRawJsonNumberToken(value)) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some(hasRawJsonNumberToken);
  }
  if (
    value instanceof Date ||
    value instanceof RegExp ||
    value instanceof Blob ||
    value instanceof FormData ||
    value instanceof URLSearchParams ||
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value)
  ) {
    return false;
  }
  return Object.values(value as Record<string, unknown>).some(
    hasRawJsonNumberToken
  );
}

export function parseJsonPreservingNumbers(jsonText: string): unknown {
  const standard = JSON.parse(jsonText);
  const unsafeSpans = extractJsonNumberSpans(jsonText).filter(
    (span) => !isRepresentableJsonNumber(span.raw)
  );
  if (unsafeSpans.length === 0) {
    return standard;
  }

  let rewritten = '';
  let cursor = 0;
  for (const span of unsafeSpans) {
    rewritten += jsonText.slice(cursor, span.start);
    rewritten += `{"${RAW_JSON_NUMBER_KEY}":"${span.raw}"}`;
    cursor = span.end;
  }
  rewritten += jsonText.slice(cursor);
  return JSON.parse(rewritten);
}

export function stringifyJsonPreservingNumbers(
  value: unknown,
  space?: number
): string | undefined {
  let hasRaw = false;
  const json = JSON.stringify(
    value,
    (_key, val) => {
      if (isRawJsonNumberToken(val)) {
        hasRaw = true;
        return `${RAW_PLACEHOLDER_PREFIX}${val[RAW_JSON_NUMBER_KEY]}${RAW_PLACEHOLDER_SUFFIX}`;
      }
      return val;
    },
    space
  );
  if (!hasRaw || json === undefined) {
    return json;
  }
  return json.replace(RAW_PLACEHOLDER_RE, '$1');
}
