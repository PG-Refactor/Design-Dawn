// Minimal runtime decoders for command payloads. A command result crosses a process
// boundary as untyped JSON, so its shape is checked before any domain parser sees it.

export type Decoded<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly detail: string };

export type Decoder<T> = (value: unknown, path: string) => Decoded<T>;

const decoded = <T>(value: T): Decoded<T> => ({ ok: true, value });
const mismatch = (path: string, expected: string): Decoded<never> => ({
  ok: false,
  detail: `${path}: expected ${expected}`,
});

export const decodeString: Decoder<string> = (value, path) =>
  typeof value === "string" ? decoded(value) : mismatch(path, "a string");

export const decodeNumber: Decoder<number> = (value, path) =>
  typeof value === "number" && Number.isFinite(value)
    ? decoded(value)
    : mismatch(path, "a finite number");

export const decodeBoolean: Decoder<boolean> = (value, path) =>
  typeof value === "boolean" ? decoded(value) : mismatch(path, "a boolean");

export function nullable<T>(inner: Decoder<T>): Decoder<T | null> {
  return (value, path) => (value === null ? decoded(null) : inner(value, path));
}

// A key that may be left out (undefined); present, it must decode with `inner`.
export function optional<T>(inner: Decoder<T>): Decoder<T | undefined> {
  return (value, path) =>
    value === undefined ? decoded(undefined) : inner(value, path);
}

export function arrayOf<T>(inner: Decoder<T>): Decoder<readonly T[]> {
  return (value, path) => {
    if (!Array.isArray(value)) return mismatch(path, "an array");
    const items: T[] = [];
    for (const [index, item] of value.entries()) {
      const result = inner(item, `${path}[${index}]`);
      if (!result.ok) return result;
      items.push(result.value);
    }
    return decoded(items);
  };
}

export function oneOf<const Values extends readonly string[]>(
  values: Values,
): Decoder<Values[number]> {
  return (value, path) => {
    const match = values.find((candidate) => candidate === value);
    return match === undefined
      ? mismatch(path, `one of ${values.join(", ")}`)
      : decoded(match);
  };
}

export type Shape<T extends object> = { [Key in keyof T]-?: Decoder<T[Key]> };

// Unknown extra keys are ignored here on purpose: Rust validates the file format strictly,
// and the client only needs the keys it declares.
export function objectOf<T extends object>(shape: Shape<T>): Decoder<T> {
  return (value, path) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return mismatch(path, "an object");
    }
    const source = value as Record<string, unknown>;
    const result: Partial<T> = {};
    for (const key of Object.keys(shape) as (keyof T & string)[]) {
      const field = shape[key](source[key], `${path}.${key}`);
      if (!field.ok) return field;
      result[key] = field.value;
    }
    // Every key of `shape` was decoded above, so the partial is complete.
    return decoded(result as T);
  };
}
