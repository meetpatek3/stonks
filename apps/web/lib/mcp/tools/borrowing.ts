import { z } from "zod";
import { McpToolError } from "../errors";
import { defineTool, type McpToolContext } from "../registrar";
import { zTradeDate } from "../schemas";

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

type Basis = "MODELLED" | "ACTUAL";

function taggedMoney(
  amountMinor: string,
  currency: string | null,
  minorUnits: number | null,
  basis: Basis,
) {
  return { amountMinor, currency, minorUnits, basis };
}

function actualInterest(
  amountMinor: string,
  currency: string | null,
  minorUnits: number | null,
  journalIds: readonly string[],
) {
  return journalIds.length === 0
    ? null
    : {
        ...taggedMoney(amountMinor, currency, minorUnits, "ACTUAL"),
        sourceJournalIds: [...journalIds],
      };
}

export const getBorrowingSummaryTool = defineTool({
  name: "get_borrowing_summary",
  description:
    "Show replay-derived credit-facility balances, FACILITY_USES slices, effective rates, " +
    "monthly interest over time, and modelled-versus-posted interest. Balances and posted " +
    "interest are tagged ACTUAL; benchmark-derived rates and accrued interest are tagged " +
    "MODELLED. Missing modelling inputs remain null with their read-model uncertainty reasons.",
  scope: "read",
  annotations: READ_ONLY,
  inputSchema: {
    facilityAccountId: z
      .string({ error: "must be a facility account id string" })
      .min(1, "must be a facility account id string")
      .optional(),
    asOf: zTradeDate
      .optional()
      .describe("Closing date for replay and interest modelling (YYYY-MM-DD)."),
  },
  async handler(ctx, input) {
    if (input.facilityAccountId !== undefined) {
      const account = await ctx.repos.accounts.getById(
        ctx.householdId,
        input.facilityAccountId,
      );
      if (account === null) {
        throw new McpToolError(
          "UNKNOWN_ACCOUNT",
          `No account ${input.facilityAccountId} in this household.`,
          "Use list_accounts to find a household-scoped CREDIT_FACILITY account id.",
        );
      }
      if (account.type !== "CREDIT_FACILITY") {
        throw new McpToolError(
          "UNKNOWN_ACCOUNT",
          `Account ${input.facilityAccountId} is not a CREDIT_FACILITY account.`,
          "Pass the id of an account whose type is CREDIT_FACILITY.",
        );
      }
    }

    const snapshot = await ctx.repos.portfolio.getSnapshot(
      ctx.householdId,
      input.asOf === undefined ? undefined : { asOf: input.asOf },
    );
    const reportingCurrency = snapshot.reportingCurrency ?? null;
    const reportingMinorUnits = snapshot.reportingMinorUnits;
    const facilities =
      input.facilityAccountId === undefined
        ? snapshot.borrowing.facilities
        : snapshot.borrowing.facilities.filter(
            (facility) => facility.accountId === input.facilityAccountId,
          );

    const wireFacilities = facilities.map((facility) => {
      const modelled = facility.variance
        ? taggedMoney(
            facility.variance.modelledTotalMinor,
            facility.currency,
            facility.minorUnits,
            "MODELLED",
          )
        : null;
      const actual = actualInterest(
        facility.interestChargedYtdMinor,
        facility.currency,
        facility.minorUnits,
        facility.actualInterestJournalIds,
      );
      const variance =
        facility.variance === null || actual === null
          ? null
          : {
              ...taggedMoney(
                facility.variance.varianceMinor,
                facility.currency,
                facility.minorUnits,
                "MODELLED",
              ),
              basis: "MODELLED_MINUS_ACTUAL" as const,
              modelled,
              actual,
              sourceJournalIds: [...facility.variance.actualJournalIds],
            };

      return {
        accountId: facility.accountId,
        accountName: facility.accountName,
        currency: facility.currency,
        minorUnits: facility.minorUnits,
        balance: taggedMoney(
          facility.outstandingMinor,
          facility.currency,
          facility.minorUnits,
          "ACTUAL",
        ),
        useBreakdown: facility.useBreakdown.map((slice) => ({
          use: slice.use,
          owed: taggedMoney(
            slice.owedMinor,
            facility.currency,
            facility.minorUnits,
            "ACTUAL",
          ),
          bps: slice.bps,
        })),
        investmentShare:
          facility.investmentShareBps === null
            ? null
            : { bps: facility.investmentShareBps, basis: "ACTUAL" as const },
        effectiveRate:
          facility.effectiveRateBps === null
            ? null
            : { rateBps: facility.effectiveRateBps, basis: "MODELLED" as const },
        interest: {
          periodStart: facility.variance?.periodStart ?? null,
          periodEnd: facility.variance?.periodEnd ?? null,
          modelled,
          actual,
          variance,
          investmentUseActual:
            facility.investmentInterestYtdMinor === null || actual === null
              ? null
              : taggedMoney(
                  facility.investmentInterestYtdMinor,
                  facility.currency,
                  facility.minorUnits,
                  "ACTUAL",
                ),
        },
        interestOverTime: facility.interestOverTime.map((point) => ({
          month: point.month,
          actual: taggedMoney(
            point.actualMinor,
            facility.currency,
            facility.minorUnits,
            "ACTUAL",
          ),
          modelled:
            point.modelledMinor === null
              ? null
              : {
                  ...taggedMoney(
                    point.modelledMinor,
                    facility.currency,
                    facility.minorUnits,
                    "MODELLED",
                  ),
                  modelledIsEstimate: point.modelledIsEstimate,
                },
        })),
        uncertaintyReasons: [
          ...facility.uncertaintyReasons,
          ...(actual === null
            ? ["No posted interest was found in the requested period; modelled interest is an estimate."]
            : []),
        ],
      };
    });

    const actualJournalIds = facilities.flatMap(
      (facility) => facility.actualInterestJournalIds,
    );
    const actualTotal =
      actualJournalIds.length === 0
        ? null
        : actualInterest(
            snapshot.borrowing.interestChargedYtdMinor ?? "0",
            reportingCurrency,
            reportingMinorUnits,
            actualJournalIds,
          );

    return {
      content: [
        {
          type: "text",
          text:
            `${wireFacilities.length} credit facilit${wireFacilities.length === 1 ? "y" : "ies"} ` +
            `returned. Modelled interest is an estimate; posted interest is ACTUAL.` +
            (snapshot.borrowing.uncertaintyReasons.length > 0
              ? " Some figures are incomplete; see uncertaintyReasons."
              : ""),
        },
      ],
      structuredContent: {
        requestedAsOf: input.asOf ?? null,
        reportingCurrency: snapshot.reportingCurrency ?? null,
        reportingMinorUnits: snapshot.reportingMinorUnits,
        facilities: wireFacilities,
        totals: {
          outstanding: taggedMoney(
            snapshot.borrowing.outstandingMinor,
            reportingCurrency,
            reportingMinorUnits,
            "ACTUAL",
          ),
          outstandingIsUncertain: snapshot.borrowing.outstandingIsUncertain,
          effectiveRate:
            snapshot.borrowing.effectiveRateBps === null
              ? null
              : {
                  rateBps: snapshot.borrowing.effectiveRateBps,
                  basis: "MODELLED" as const,
                },
          interestCharged: actualTotal,
          investmentShare:
            snapshot.borrowing.investmentShareBps === null
              ? null
              : {
                  bps: snapshot.borrowing.investmentShareBps,
                  basis: "ACTUAL" as const,
                },
        },
        uncertaintyReasons: snapshot.borrowing.uncertaintyReasons,
      },
    };
  },
});

export const getInterestAttributionTool = defineTool({
  name: "get_interest_attribution",
  description:
    "Allocate actual investment-use interest to held positions by the ledger's dollar-day " +
    "read model. Interest, unallocated interest, and each allocation are tagged ACTUAL; " +
    "dollar-days and source journal ids remain visible for traceability.",
  scope: "read",
  annotations: READ_ONLY,
  inputSchema: {
    from: zTradeDate.describe("Inclusive period start (YYYY-MM-DD)."),
    to: zTradeDate.describe("Exclusive period end (YYYY-MM-DD)."),
  },
  async handler(ctx, input) {
    if (input.to <= input.from) {
      throw new McpToolError(
        "INVALID_INPUT",
        `periodEnd must be after periodStart; received ${input.to} and ${input.from}.`,
        "Pass a half-open range with to later than from.",
      );
    }

    const attribution = await ctx.repos.interest.getAttribution(
      ctx.householdId,
      input.from,
      input.to,
    );
    const minorUnits = attribution.reportingMinorUnits;
    const interest =
      attribution.investmentInterestMinor === null
        ? null
        : {
            ...taggedMoney(
              attribution.investmentInterestMinor,
              attribution.reportingCurrency,
              minorUnits,
              "ACTUAL",
            ),
            sourceJournalIds: [...attribution.actualInterestJournalIds],
          };
    const unallocated =
      attribution.unallocatedMinor === null
        ? null
        : taggedMoney(
            attribution.unallocatedMinor,
            attribution.reportingCurrency,
            minorUnits,
            "ACTUAL",
          );

    return {
      content: [
        {
          type: "text",
          text:
            `Investment interest attribution for [${attribution.periodStart}, ` +
            `${attribution.periodEnd}) returned ${attribution.allocations.length} position(s).` +
            (attribution.investmentInterestMinor === null
              ? " The actual investment-use amount is incomplete; see uncertaintyReasons."
              : ""),
        },
      ],
      structuredContent: {
        periodStart: attribution.periodStart,
        periodEnd: attribution.periodEnd,
        reportingCurrency: attribution.reportingCurrency,
        reportingMinorUnits: attribution.reportingMinorUnits,
        interest,
        allocations: attribution.allocations.map((allocation) => ({
          accountId: allocation.accountId,
          securityId: allocation.securityId,
          interest: taggedMoney(
            allocation.interestMinor,
            attribution.reportingCurrency,
            minorUnits,
            "ACTUAL",
          ),
          dollarDaysReporting: allocation.dollarDaysReporting,
          sourceJournalIds: [...allocation.sourceJournalIds],
        })),
        unallocated,
        uncertaintyReasons: attribution.uncertaintyReasons,
      },
    };
  },
});
