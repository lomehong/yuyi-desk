import { describe, expect, it } from "vitest";
import { parseLinkifiedText } from "./linkified-text";

describe("parseLinkifiedText", () => {
  it("keeps surrounding text and excludes trailing Chinese punctuation from the URL", () => {
    expect(parseLinkifiedText("看 https://example.com/a。然后继续")).toEqual([
      { type: "text", text: "看 " },
      { type: "url", text: "https://example.com/a", href: "https://example.com/a" },
      { type: "text", text: "。然后继续" },
    ]);
  });

  it("does not link non-http schemes", () => {
    expect(parseLinkifiedText("file:///tmp/a")).toEqual([{ type: "text", text: "file:///tmp/a" }]);
  });
});
