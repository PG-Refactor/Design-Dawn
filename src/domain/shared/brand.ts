declare const brandSymbol: unique symbol;

// Nominal typing so that e.g. a SheetId cannot be passed where a BlockId is expected.
export type Brand<Base, Name extends string> = Base & {
  readonly [brandSymbol]: Name;
};
