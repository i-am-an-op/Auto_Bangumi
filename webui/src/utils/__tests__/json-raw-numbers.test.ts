import { describe, expect, it } from 'vitest';
import {
  isRawJsonNumberToken,
  parseJsonPreservingNumbers,
  stringifyJsonPreservingNumbers,
} from '@/utils/json-raw-numbers';

describe('json-raw-numbers', () => {
  it('should preserve unsafe integers and high-precision numbers across parse, JSON clone, and stringify', () => {
    const raw =
      '{"a":{"future_number":9007199254740993,"neg":-9007199254740993,"u64":18446744073709551615,"precise":0.12345678901234567890,"tiny":1e-400,"safe":42,"safe_max":9007199254740991,"str":"9007199254740993","escaped":"\\"9007199254740993\\""},"arr":[1,9007199254740993]}';

    const parsed = parseJsonPreservingNumbers(raw) as {
      a: Record<string, unknown>;
      arr: unknown[];
    };

    // Safe numbers remain native JS numbers; strings remain strings
    expect(parsed.a.safe).toBe(42);
    expect(parsed.a.safe_max).toBe(9007199254740991);
    expect(parsed.a.str).toBe('9007199254740993');
    expect(parsed.a.escaped).toBe('"9007199254740993"');
    expect(isRawJsonNumberToken(parsed.a.future_number)).toBe(true);
    expect(isRawJsonNumberToken(parsed.arr[1])).toBe(true);

    // Survives plain JSON.parse(JSON.stringify(...)) clones used by stores/dialogs
    const cloned = JSON.parse(JSON.stringify(parsed));
    expect(stringifyJsonPreservingNumbers(cloned)).toBe(raw);
  });

  it('should throw SyntaxError on non-JSON text containing large digits', () => {
    expect(() =>
      parseJsonPreservingNumbers('2026-11-20 INFO id=9007199254740993')
    ).toThrow(SyntaxError);
  });
});
