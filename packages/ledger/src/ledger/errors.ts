export class ValidationError extends Error {
  constructor(
    message: string,
    readonly code:
      | "UNBALANCED"
      | "NEGATIVE_QUANTITY"
      | "FACILITY_USE"
      | "CURRENCY"
      | "UNKNOWN_ACCOUNT"
      | "UNKNOWN_JOURNAL"
      | "NOT_POSTED"
      | "MISSING_COST"
      | "COST_CURRENCY"
      | "ACCOUNT"
      | "TERMS"
      | "BENCHMARK",
    readonly journalIds: string[] = [],
  ) {
    super(message);
    this.name = "ValidationError";
  }
}
