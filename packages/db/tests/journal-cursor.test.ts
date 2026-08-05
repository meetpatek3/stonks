import { describe, expect, it } from "vitest";
import {
  decodeJournalCursor,
  encodeJournalCursor,
} from "../src/repos/journal-repo.js";

/**
 * Cursor codec for `listAll` pagination — pure, DB-free.
 * The cursor pins a position in (trade_date, sort_key, id) order; it is an
 * opaque string to callers.
 */
describe("journal cursor codec", () => {
  it("round-trips a position", () => {
    const position = { tradeDate: "2024-06-15", sortKey: 7, id: "j-abc" };
    const encoded = encodeJournalCursor(position);
    expect(typeof encoded).toBe("string");
    expect(encoded).not.toContain("j-abc"); // opaque — not the raw id
    expect(decodeJournalCursor(encoded)).toEqual(position);
  });

  it("sortKey 0 is preserved", () => {
    const position = { tradeDate: "2024-01-01", sortKey: 0, id: "j" };
    expect(decodeJournalCursor(encodeJournalCursor(position))).toEqual(position);
  });

  it("rejects garbage without throwing", () => {
    expect(decodeJournalCursor("")).toBeNull();
    expect(decodeJournalCursor("not-a-cursor")).toBeNull();
    expect(decodeJournalCursor("%%%")).toBeNull();
  });

  it("rejects well-formed base64 with the wrong shape", () => {
    const wrong = Buffer.from(JSON.stringify({ tradeDate: "2024-01-01" }), "utf8").toString(
      "base64url",
    );
    expect(decodeJournalCursor(wrong)).toBeNull();

    const badSortKey = Buffer.from(
      JSON.stringify({ tradeDate: "2024-01-01", sortKey: "7", id: "j" }),
      "utf8",
    ).toString("base64url");
    expect(decodeJournalCursor(badSortKey)).toBeNull();
  });
});
