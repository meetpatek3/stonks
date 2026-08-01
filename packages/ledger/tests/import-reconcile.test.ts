import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { CAD, money } from "../src/index.js";
import { matchImportCandidates } from "../src/import/match.js";
import { reconcileStatement } from "../src/import/reconcile.js";
import type { ImportCandidate, Statement } from "../src/import/types.js";
import type { Journal } from "../src/ledger/types.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "../../../fixtures/import");

function parseMoneyPosting(
  posting: { accountId: string; amount: { currency: string; minor: string } },
) {
  return {
    accountId: posting.accountId,
    amount: money(posting.amount.currency, BigInt(posting.amount.minor)),
  };
}

function parseJournal(raw: {
  id: string;
  type: Journal["type"];
  tradeDate: string;
  sortKey: number;
  status: Journal["status"];
  source: Journal["source"];
  externalNaturalKey?: string;
  postings: Array<{ accountId: string; amount: { currency: string; minor: string } }>;
}): Journal {
  return {
    id: raw.id,
    type: raw.type,
    tradeDate: raw.tradeDate,
    sortKey: raw.sortKey,
    status: raw.status,
    source: raw.source,
    externalNaturalKey: raw.externalNaturalKey,
    postings: raw.postings.map(parseMoneyPosting),
  };
}

describe("matchImportCandidates", () => {
  const fixture = JSON.parse(
    readFileSync(join(fixturesDir, "sample-candidates.json"), "utf8"),
  ) as {
    candidates: Array<{
      id: string;
      externalNaturalKey: string;
      tradeDate: string;
      proposedJournal: Parameters<typeof parseJournal>[0];
    }>;
    existingJournals: Array<Parameters<typeof parseJournal>[0]>;
    expected: {
      newCandidateId: string;
      duplicateCandidateId: string;
      conflictCandidateId: string;
      matchedJournalId: string;
    };
  };

  const candidates: ImportCandidate[] = fixture.candidates.map((c) => ({
    id: c.id,
    externalNaturalKey: c.externalNaturalKey,
    tradeDate: c.tradeDate,
    proposedJournal: parseJournal(c.proposedJournal),
  }));

  const existingJournals = fixture.existingJournals.map(parseJournal);

  it("classifies candidates from fixture as NEW, DUPLICATE, or CONFLICT", () => {
    const matched = matchImportCandidates(candidates, existingJournals);

    const newMatch = matched.find((m) => m.id === fixture.expected.newCandidateId);
    const dupMatch = matched.find((m) => m.id === fixture.expected.duplicateCandidateId);
    const conflictMatch = matched.find((m) => m.id === fixture.expected.conflictCandidateId);

    expect(newMatch?.matchState).toBe("NEW");
    expect(newMatch?.matchedJournalId).toBeUndefined();

    expect(dupMatch?.matchState).toBe("DUPLICATE");
    expect(dupMatch?.matchedJournalId).toBe(fixture.expected.matchedJournalId);

    expect(conflictMatch?.matchState).toBe("CONFLICT");
    expect(conflictMatch?.matchedJournalId).toBe(fixture.expected.matchedJournalId);
  });
});

describe("reconcileStatement", () => {
  const rawStatement = JSON.parse(
    readFileSync(join(fixturesDir, "sample-statement.json"), "utf8"),
  ) as {
    id: string;
    accountId: string;
    periodStart: string;
    periodEnd: string;
    statedBalanceMinor: string;
    statedAsOf: string;
    sourceLabel: string;
  };

  const statement: Statement = {
    ...rawStatement,
    statedBalanceMinor: BigInt(rawStatement.statedBalanceMinor),
  };

  it("reports MATCH when computed balance equals stated balance", () => {
    const result = reconcileStatement(statement, 60000n);
    expect(result).toEqual({
      statementId: "stmt-cash-2024-q1",
      computedBalanceMinor: 60000n,
      statedBalanceMinor: 60000n,
      status: "MATCH",
    });
  });

  it("reports MISMATCH when balances differ — never auto-adjusts", () => {
    const result = reconcileStatement(statement, 59999n);
    expect(result.status).toBe("MISMATCH");
    expect(result.computedBalanceMinor).toBe(59999n);
    expect(result.statedBalanceMinor).toBe(60000n);
  });
});
