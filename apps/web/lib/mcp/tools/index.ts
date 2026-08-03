import type { AnyToolDefinition } from "../registrar";
import { pingTool } from "./ping";
import {
  getPortfolioOverviewTool,
  listAccountsTool,
  listOpenItemsTool,
  listPositionsTool,
} from "./portfolio";
import { getJournalTool, listJournalsTool } from "./journals-read";

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
];
