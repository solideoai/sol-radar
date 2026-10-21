import { describe, expect, it } from "vitest";
import { getDocumentDownload } from "./documents.service";

describe("private document downloads", () => {
  it("issues a 60-second attachment URL only for a readable document under the requested bid", async () => {
    const calls: unknown[] = [];
    const result = await getDocumentDownload("bid", "doc", {
      find: async () => ({
        id: "doc",
        bidId: "bid",
        bucket: "bid-documents",
        path: "raw/bids/file.pdf",
        name: "RFP.pdf",
        downloadStatus: "OK",
      }),
      sign: async (...args) => {
        calls.push(args);
        return "https://storage.test/signed";
      },
    });
    expect(result).toEqual({
      ok: true,
      status: 200,
      data: { url: "https://storage.test/signed", expiresIn: 60 },
    });
    expect(calls).toEqual([["bid-documents", "raw/bids/file.pdf", "RFP.pdf", 60]]);
  });
  it("returns 404 for a foreign bid or unavailable raw file without signing", async () => {
    for (const row of [
      null,
      {
        id: "doc",
        bidId: "other",
        bucket: "bid-documents",
        path: "p",
        name: "n",
        downloadStatus: "OK",
      },
      { id: "doc", bidId: "bid", bucket: null, path: null, name: "n", downloadStatus: "PENDING" },
    ]) {
      const result = await getDocumentDownload("bid", "doc", {
        find: async () => row,
        sign: async () => {
          throw new Error("must not sign");
        },
      });
      expect(result).toMatchObject({ ok: false, status: 404 });
    }
  });
  it("normalizes Storage errors without exposing the signed URL or provider error", async () => {
    const result = await getDocumentDownload("bid", "doc", {
      find: async () => ({
        id: "doc",
        bidId: "bid",
        bucket: "bid-documents",
        path: "p",
        name: "n",
        downloadStatus: "OK",
      }),
      sign: async () => {
        throw new Error("secret upstream URL");
      },
    });
    expect(result).toMatchObject({ ok: false, status: 503, details: { component: "storage" } });
    expect(JSON.stringify(result)).not.toContain("secret");
  });
});
