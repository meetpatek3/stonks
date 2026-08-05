import { describe, expect, it } from "vitest";
import { buildEntryPostings } from "../lib/entry-postings";

describe("buildEntryPostings", () => {
  it("BUY uses same account for cash and security legs", () => {
    const legs = buildEntryPostings({
      type: "BUY",
      accountId: "broker",
      amountMinor: 100_00n,
      quantity: "10",
      securityId: "XEQT",
    });
    expect(legs).toEqual([
      { accountId: "broker", amountMinor: "-10000" },
      {
        accountId: "broker",
        amountMinor: "10000",
        quantity: "10",
        securityId: "XEQT",
      },
    ]);
  });

  it("SELL negates quantity and proceeds on the security leg", () => {
    const legs = buildEntryPostings({
      type: "SELL",
      accountId: "broker",
      amountMinor: 50_00n,
      quantity: "5",
      securityId: "XEQT",
    });
    expect(legs).toEqual([
      {
        accountId: "broker",
        amountMinor: "-5000",
        quantity: "-5",
        securityId: "XEQT",
      },
      { accountId: "broker", amountMinor: "5000" },
    ]);
  });

  it("OPENING position with unknown cost is 0/0 with quantity", () => {
    const legs = buildEntryPostings({
      type: "OPENING",
      mode: "position",
      accountId: "broker",
      externalAccountId: "ext",
      quantity: "100",
      securityId: "AAPL",
      costMinor: null,
    });
    expect(legs).toEqual([
      {
        accountId: "broker",
        amountMinor: "0",
        quantity: "100",
        securityId: "AAPL",
      },
      { accountId: "ext", amountMinor: "0" },
    ]);
  });

  it("DEPOSIT is EXTERNAL → account", () => {
    expect(
      buildEntryPostings({
        type: "DEPOSIT",
        accountId: "cash",
        externalAccountId: "ext",
        amountMinor: 1_00n,
      }),
    ).toEqual([
      { accountId: "ext", amountMinor: "-100" },
      { accountId: "cash", amountMinor: "100" },
    ]);
  });

  it("TRANSFER moves from − to +", () => {
    expect(
      buildEntryPostings({
        type: "TRANSFER",
        fromAccountId: "cash",
        toAccountId: "broker",
        amountMinor: 500_00n,
      }),
    ).toEqual([
      { accountId: "cash", amountMinor: "-50000" },
      { accountId: "broker", amountMinor: "50000" },
    ]);
  });

  it("WITHDRAWAL is account → EXTERNAL", () => {
    expect(
      buildEntryPostings({
        type: "WITHDRAWAL",
        accountId: "cash",
        externalAccountId: "ext",
        amountMinor: 250_00n,
      }),
    ).toEqual([
      { accountId: "cash", amountMinor: "-25000" },
      { accountId: "ext", amountMinor: "25000" },
    ]);
  });

  it("OPENING cash is EXTERNAL → account", () => {
    expect(
      buildEntryPostings({
        type: "OPENING",
        mode: "cash",
        accountId: "cash",
        externalAccountId: "ext",
        amountMinor: 1_000_00n,
      }),
    ).toEqual([
      { accountId: "ext", amountMinor: "-100000" },
      { accountId: "cash", amountMinor: "100000" },
    ]);
  });

  it("OPENING position with cost debits EXTERNAL and credits account", () => {
    expect(
      buildEntryPostings({
        type: "OPENING",
        mode: "position",
        accountId: "broker",
        externalAccountId: "ext",
        quantity: "50",
        securityId: "XEQT",
        costMinor: 2_500_00n,
      }),
    ).toEqual([
      {
        accountId: "broker",
        amountMinor: "250000",
        quantity: "50",
        securityId: "XEQT",
      },
      { accountId: "ext", amountMinor: "-250000" },
    ]);
  });

  it("DIVIDEND attaches optional securityId on the household leg", () => {
    expect(
      buildEntryPostings({
        type: "DIVIDEND",
        accountId: "broker",
        externalAccountId: "ext",
        amountMinor: 42_00n,
        securityId: "XEQT",
      }),
    ).toEqual([
      { accountId: "ext", amountMinor: "-4200" },
      {
        accountId: "broker",
        amountMinor: "4200",
        securityId: "XEQT",
      },
    ]);
  });
});
