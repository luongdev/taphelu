

export class TapheluError extends Error {
  constructor(message) {
    super(message);
    this.name = "TapheluError";
  }
}

export function fail(message) {
  throw new TapheluError(message);
}
