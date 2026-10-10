// The type of a message catalog written in one language, with the literal strings widened
// to `string`. A catalog of another language is annotated with it, so a missing or extra
// key (or a function with another signature) is a compile error instead of a blank in the
// UI. Functions are kept as they are: they take the variable parts of a sentence, because
// word order differs between languages.
export type Widen<Value> = Value extends string
  ? string
  : Value extends (...parameters: never[]) => unknown
    ? Value
    : Value extends object
      ? { [Key in keyof Value]: Widen<Value[Key]> }
      : Value;
