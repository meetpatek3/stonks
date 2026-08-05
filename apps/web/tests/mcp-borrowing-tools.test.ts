import { describe, expect, it } from "vitest";
import { money, type Account, type Journal } from "@stonks/ledger";
import type { AccountRecord } from "@stonks/db";
import { derivePortfolioSnapshot, type AccountMeta } from "@/lib/portfolio-derive";
import { getBorrowingSummaryTool } from "@/lib/mcp/tools/borrowing";
import { invokeTool } from "@/lib/mcp/registrar";
import { makeTestCtx, assertMoneyFieldsAreStrings } from "./helpers/mcp-test-utils";

const ACCOUNTS: AccountMeta[] = [
  {
    id: "facility-a",
    name: "Investment loan",
    type: "CREDIT_FACILITY",
    currency: "CAD",
    minorUnits: 2,
  },
  {
    id: "investment-a",
    name: "Brokerage",
    type: "INVESTMENT",
    currency: "CAD",
    minorUnits: 2,
  },
  {
    id: "world-a",
    name: "Outside world",
    type: "EXTERNAL",
    currency: "CAD",
    minorUnits: 2,
  },
];

const DRAW: Journal = {
  id: "draw-a",
  type: "TRANSFER",
  tradeDate: "2024-01-01",
  sortKey: 0,
  status: "POSTED",
  source: "MANUAL",
  postings: [
    { accountId: "facility-a", amount: money("CAD", -100_000n) },
    { accountId: "investment-a", amount: money("CAD", 100_000n) },
  ],
  facilityUses: [{ use: "INVESTMENT", amount: money("CAD", 100_000n) }],
};

const ACTUAL_INTEREST: Journal = {
  id: "interest-a",
  type: "INTEREST_CHARGED",
  tradeDate: "2024-01-10",
  sortKey: 0,
  status: "POSTED",
  source: "MANUAL",
  postings: [
    { accountId: "facility-a", amount: money("CAD", -90n) },
    { accountId: "world-a", amount: money("CAD", 90n) },
  ],
  facilityUses: [{ use: "INVESTMENT", amount: money("CAD", 90n) }],
};

const SNAPSHOT_A = derivePortfolioSnapshot({
  householdId: "hh-a",
  reportingCurrency: "CAD",
  reportingMinorUnits: 2,
  accounts: ACCOUNTS,
  journals: [DRAW, ACTUAL_INTEREST],
  facilityTerms: [
    {
      terms: {
        facilityAccountId: "facility-a",
        spreadBps: 0,
        dayCount: "ACT_365",
        postingDayRule: "CALENDAR_DAY",
        capitalizeInterest: true,
      },
      benchmarkCurve: [{ effectiveDate: "2024-01-01", rateBps: 365 }],
    },
  ],
  asOf: "2024-01-10",
});

const ACCOUNT_RECORDS: AccountRecord[] = ACCOUNTS.map((account) => ({
  ...account,
  taxTreatment: null,
  closedAt: null,
}));

function accountRepoFor(householdId: string, rows: AccountRecord[]) {
  return {
    list: async () => rows,
    getById: async (requestedHouseholdId: string, id: string) =>
      requestedHouseholdId === householdId
        ? rows.find((row) => row.id === id) ?? null
        : null,
    listCurrencies: async () => [],
    getCurrency: async () => null,
    create: async () => {
      throw new Error("not used");
    },
    close: async () => null,
  };
}

describe("get_borrowing_summary", () => {
  it("returns household-scoped balances and distinguishes modelled from actual interest", async () => {
    const calls: Array<{ householdId: string; options?: unknown }> = [];
    const ctx = makeTestCtx({
      householdId: "hh-a",
      repos: {
        portfolio: {
          getSnapshot: async (householdId, options) => {
            calls.push({ householdId, options });
            return SNAPSHOT_A;
          },
        },
        accounts: accountRepoFor("hh-a", ACCOUNT_RECORDS),
      },
    });

    const result = await invokeTool(getBorrowingSummaryTool, ctx, {
      asOf: "2024-01-10",
    });

    expect(result.isError).toBeUndefined();
    const out = result.structuredContent as {
      facilities: Array<{
        accountId: string;
        balance: { amountMinor: string; basis: string };
        useBreakdown: Array<{ use: string; amountMinor: string; basis: string }>;
        effectiveRate: { rateBps: number; basis: string } | null;
        interest: {
          modelled: { amountMinor: string; basis: string } | null;
          actual: { amountMinor: string; basis: string } | null;
          variance: {
            amountMinor: string;
            basis: string;
            modelled: { amountMinor: string; basis: string };
            actual: { amountMinor: string; basis: string };
          } | null;
        };
        interestOverTime: Array<{
          month: string;
          actual: {
            amountMinor: string;
            currency: string | null;
            minorUnits: number | null;
            basis: string;
          };
          modelled: {
            amountMinor: string;
            currency: string | null;
            minorUnits: number | null;
            basis: string;
            modelledIsEstimate: true;
          } | null;
        }>;
      }>;
    };

    assertMoneyFieldsAreStrings(out);
    const facility = out.facilities[0]!;
    expect(facility.accountId).toBe("facility-a");
    expect(facility.balance).toMatchObject({ amountMinor: "100090", basis: "ACTUAL" });
    expect(
      facility.useBreakdown.find((row) => row.use === "INVESTMENT"),
    ).toMatchObject({ owed: { amountMinor: "100090", basis: "ACTUAL" } });
    expect(facility.effectiveRate).toEqual({ rateBps: 365, basis: "MODELLED" });
    expect(facility.interest.modelled).toEqual({
      amountMinor: "100",
      currency: "CAD",
      minorUnits: 2,
      basis: "MODELLED",
    });
    expect(facility.interest.actual).toEqual({
      amountMinor: "90",
      currency: "CAD",
      minorUnits: 2,
      basis: "ACTUAL",
      sourceJournalIds: ["interest-a"],
    });
    expect(facility.interest.variance).toMatchObject({
      amountMinor: "10",
      basis: "MODELLED_MINUS_ACTUAL",
      modelled: { amountMinor: "100", basis: "MODELLED" },
      actual: { amountMinor: "90", basis: "ACTUAL" },
    });
    expect(facility.interestOverTime).toEqual([
      {
        month: "2024-01",
        actual: {
          amountMinor: "90",
          currency: "CAD",
          minorUnits: 2,
          basis: "ACTUAL",
        },
        modelled: {
          amountMinor: "100",
          currency: "CAD",
          minorUnits: 2,
          basis: "MODELLED",
          modelledIsEstimate: true,
        },
      },
    ]);
    expect(calls).toEqual([{ householdId: "hh-a", options: { asOf: "2024-01-10" } }]);
  });

  it("does not present absent posted interest as an actual zero", async () => {
    const snapshotWithoutActual = derivePortfolioSnapshot({
      householdId: "hh-a",
      reportingCurrency: "CAD",
      reportingMinorUnits: 2,
      accounts: ACCOUNTS,
      journals: [DRAW],
      facilityTerms: [
        {
          terms: {
            facilityAccountId: "facility-a",
            spreadBps: 0,
            dayCount: "ACT_365",
            postingDayRule: "CALENDAR_DAY",
            capitalizeInterest: true,
          },
          benchmarkCurve: [{ effectiveDate: "2024-01-01", rateBps: 365 }],
        },
      ],
      asOf: "2024-01-01",
    });
    const result = await invokeTool(
      getBorrowingSummaryTool,
      makeTestCtx({
        repos: {
          portfolio: { getSnapshot: async () => snapshotWithoutActual },
          accounts: accountRepoFor("hh-a", ACCOUNT_RECORDS),
        },
      }),
      { asOf: "2024-01-01" },
    );

    const facility = (
      result.structuredContent as {
        facilities: Array<{
          interest: {
            modelled: { amountMinor: string } | null;
            actual: unknown;
            variance: unknown;
          };
          uncertaintyReasons: string[];
        }>;
      }
    ).facilities[0]!;
    expect(facility.interest.modelled?.amountMinor).toBe("10");
    expect(facility.interest.actual).toBeNull();
    expect(facility.interest.variance).toBeNull();
    expect(facility.uncertaintyReasons).toContain(
      "No posted interest was found in the requested period; modelled interest is an estimate.",
    );
  });

  it("rejects a real facility id from another household without reading that household", async () => {
    const calls: string[] = [];
    const ctx = makeTestCtx({
      householdId: "hh-a",
      repos: {
        portfolio: {
          getSnapshot: async (householdId) => {
            calls.push(`portfolio:${householdId}`);
            return SNAPSHOT_A;
          },
        },
        accounts: {
          ...accountRepoFor("hh-a", ACCOUNT_RECORDS),
          getById: async (householdId, id) => {
            calls.push(`account:${householdId}:${id}`);
            return householdId === "hh-a" && id === "facility-a"
              ? ACCOUNT_RECORDS.find((row) => row.id === id) ?? null
              : null;
          },
        },
      },
    });

    const result = await invokeTool(getBorrowingSummaryTool, ctx, {
      facilityAccountId: "facility-b",
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ code: "UNKNOWN_ACCOUNT" });
    expect(calls).toEqual(["account:hh-a:facility-b"]);
  });
});
