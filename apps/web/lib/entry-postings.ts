export type WirePosting = {
  accountId: string;
  amountMinor: string;
  quantity?: string;
  securityId?: string;
};

export type BuildEntryPostingsInput =
  | {
      type: "DEPOSIT" | "DIVIDEND" | "INTEREST_EARNED";
      accountId: string;
      externalAccountId: string;
      amountMinor: bigint;
      securityId?: string;
    }
  | {
      type: "WITHDRAWAL" | "FEE" | "INTEREST_CHARGED";
      accountId: string;
      externalAccountId: string;
      amountMinor: bigint;
      securityId?: string;
    }
  | {
      type: "TRANSFER";
      fromAccountId: string;
      toAccountId: string;
      amountMinor: bigint;
    }
  | {
      type: "BUY";
      accountId: string;
      amountMinor: bigint;
      quantity: string;
      securityId: string;
    }
  | {
      type: "SELL";
      accountId: string;
      amountMinor: bigint;
      quantity: string;
      securityId: string;
    }
  | {
      type: "OPENING";
      mode: "cash";
      accountId: string;
      externalAccountId: string;
      amountMinor: bigint;
    }
  | {
      type: "OPENING";
      mode: "position";
      accountId: string;
      externalAccountId: string;
      quantity: string;
      securityId: string;
      costMinor?: bigint | null;
    };

function minorToString(amount: bigint): string {
  return amount.toString();
}

function negateMinor(amount: bigint): string {
  return (-amount).toString();
}

function negateQtyDecimal(qty: string): string {
  const trimmed = qty.trim();
  if (trimmed.startsWith("-")) return trimmed;
  return `-${trimmed}`;
}

export function buildEntryPostings(
  input: BuildEntryPostingsInput,
): WirePosting[] {
  switch (input.type) {
    case "DEPOSIT":
    case "DIVIDEND":
    case "INTEREST_EARNED": {
      const household: WirePosting = {
        accountId: input.accountId,
        amountMinor: minorToString(input.amountMinor),
      };
      if (input.securityId !== undefined) {
        household.securityId = input.securityId;
      }
      return [
        {
          accountId: input.externalAccountId,
          amountMinor: negateMinor(input.amountMinor),
        },
        household,
      ];
    }
    case "WITHDRAWAL":
    case "FEE":
    case "INTEREST_CHARGED": {
      const household: WirePosting = {
        accountId: input.accountId,
        amountMinor: negateMinor(input.amountMinor),
      };
      if (input.securityId !== undefined) {
        household.securityId = input.securityId;
      }
      return [
        household,
        {
          accountId: input.externalAccountId,
          amountMinor: minorToString(input.amountMinor),
        },
      ];
    }
    case "TRANSFER":
      return [
        {
          accountId: input.fromAccountId,
          amountMinor: negateMinor(input.amountMinor),
        },
        {
          accountId: input.toAccountId,
          amountMinor: minorToString(input.amountMinor),
        },
      ];
    case "BUY":
      return [
        {
          accountId: input.accountId,
          amountMinor: negateMinor(input.amountMinor),
        },
        {
          accountId: input.accountId,
          amountMinor: minorToString(input.amountMinor),
          quantity: input.quantity,
          securityId: input.securityId,
        },
      ];
    case "SELL":
      return [
        {
          accountId: input.accountId,
          amountMinor: negateMinor(input.amountMinor),
          quantity: negateQtyDecimal(input.quantity),
          securityId: input.securityId,
        },
        {
          accountId: input.accountId,
          amountMinor: minorToString(input.amountMinor),
        },
      ];
    case "OPENING":
      if (input.mode === "cash") {
        return [
          {
            accountId: input.externalAccountId,
            amountMinor: negateMinor(input.amountMinor),
          },
          {
            accountId: input.accountId,
            amountMinor: minorToString(input.amountMinor),
          },
        ];
      }
      {
        const cost = input.costMinor ?? 0n;
        const accountLeg: WirePosting = {
          accountId: input.accountId,
          amountMinor: minorToString(cost),
          quantity: input.quantity,
          securityId: input.securityId,
        };
        const externalLeg: WirePosting = {
          accountId: input.externalAccountId,
          amountMinor:
            input.costMinor != null ? negateMinor(cost) : "0",
        };
        return [accountLeg, externalLeg];
      }
  }
}
