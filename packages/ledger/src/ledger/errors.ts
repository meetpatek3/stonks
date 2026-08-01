export class ValidationError extends Error {
  constructor(
    message: string,
    readonly code: "UNBALANCED" | "NEGATIVE_QUANTITY" | "FACILITY_USE" | "CURRENCY",
    readonly journalIds: string[] = [],
  ) {
    super(message);
    this.name = "ValidationError";
  }
}
