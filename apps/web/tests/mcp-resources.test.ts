import { describe, expect, it, vi } from "vitest";
import {
  JOURNAL_TYPES_RESOURCE_URI,
  registerMcpResources,
} from "@/lib/mcp/resources";

describe("MCP reference resources", () => {
  it("registers a useful journal-types reference at the schema error URI", async () => {
    const registerResource = vi.fn();
    registerMcpResources({ registerResource } as never);

    expect(registerResource).toHaveBeenCalledWith(
      "journal-types",
      JOURNAL_TYPES_RESOURCE_URI,
      expect.objectContaining({
        mimeType: "text/markdown",
      }),
      expect.any(Function),
    );

    const [, uri, , readResource] = registerResource.mock.calls[0]!;
    const result = await readResource(new URL(uri), {} as never);
    const text = result.contents[0]!.text as string;

    expect(uri).toBe("stonks://reference/journal-types");
    expect(text).toContain("debit-positive");
    expect(text).toContain("sum to zero");
    expect(text).toContain("amountMinor");
    expect(text).toContain('"amountMinor": "-100000"');
    expect(text).toContain('"amountMinor": "100000"');
  });
});
