import type { AnyToolDefinition } from "../registrar";
import { pingTool } from "./ping";
import {
  getPortfolioOverviewTool,
  listAccountsTool,
  listOpenItemsTool,
  listPositionsTool,
} from "./portfolio";
import { getJournalTool, listJournalsTool } from "./journals-read";
import { recordJournalTool, supersedeJournalTool } from "./journals-write";
import { closeAccountTool, createAccountTool } from "./accounts";
import {
  getBorrowingSummaryTool,
  getInterestAttributionTool,
} from "./borrowing";
import { getTaxYearSummaryTool } from "./tax";
import { getPriceTool, setPriceOverrideTool } from "./prices";

/**
 * The MCP tool registry. Later tasks add their tools here; the route
 * registers exactly this list. Token/credential management is deliberately
 * never part of it (spec §1 Non-goals).
 */
export const MCP_TOOLS: ReadonlyArray<AnyToolDefinition> = [
  pingTool,
  getPortfolioOverviewTool,
  listAccountsTool,
  listPositionsTool,
  listOpenItemsTool,
  listJournalsTool,
  getJournalTool,
  recordJournalTool,
  supersedeJournalTool,
  createAccountTool,
  closeAccountTool,
  getBorrowingSummaryTool,
  getInterestAttributionTool,
  getTaxYearSummaryTool,
  getPriceTool,
  setPriceOverrideTool,
];
