import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  createG2bAttachmentFetcher,
  type AttachmentResponse,
  type AttachmentTransport,
} from "./g2b-attachment-fetcher";

// 네트워크 대신 가짜 전송을 넣어 fetcher 의 판정 순서(허용 목록 → 리다이렉트 → 크기 → 형식)를 본다.
const ATTACHMENT = "https://www.g2b.go.kr/pn/pnp/pnpe/UntyAtchFile/downloadFile.do?fileSeq=1";
const PDF = new TextEncoder().encode("%PDF-1.7\n본문");
const MIB = 1024 * 1024;

type Step = Omit<AttachmentResponse, "close" | "body"> & { body?: AsyncIterable<Uint8Array> };

async function* chunksOf(...chunks: Uint8Array[]) {
  yield* chunks;
}

/** 요청 순서대로 응답을 돌려주고, 요청한 URL 과 닫은 횟수를 남긴다 */
function scripted(steps: Step[]) {
  const urls: string[] = [];
  const close = vi.fn();
  const transport: AttachmentTransport = async (url) => {
    urls.push(url.href);
    const step = steps[urls.length - 1];
    if (step === undefined) throw new Error("예상하지 않은 요청");
    return { ...step, body: step.body ?? chunksOf(), close };
  };
  return { transport, urls, close };
}

const redirect = (location: string): Step => ({ status: 302, location, contentLength: null });

describe("G2bAttachmentFetcher", () => {
  it("허용 목록 밖 URL 은 요청하지 않고 HOST_NOT_ALLOWED 로 끝낸다", async () => {
    const { transport, urls } = scripted([]);
    const fetcher = createG2bAttachmentFetcher({ transport });

    for (const url of [
      "http://www.g2b.go.kr/pn/file.do",
      "https://attacker.example/pn/file.do",
      "https://www.g2b.go.kr:8443/pn/file.do",
      "https://www.g2b.go.kr/admin/file.do",
    ]) {
      await expect(fetcher.fetch({ name: "공고서.pdf", url })).resolves.toEqual({
        status: "FAILED",
        errorCode: "HOST_NOT_ALLOWED",
      });
    }
    expect(urls).toEqual([]);
  });

  it("다른 호스트로 가는 리다이렉트는 따라가지 않고, 로그인 경로는 AUTH_REQUIRED 다", async () => {
    const external = scripted([redirect("https://attacker.example/pn/file.do")]);
    await expect(
      createG2bAttachmentFetcher({ transport: external.transport }).fetch({
        name: "공고서.pdf",
        url: ATTACHMENT,
      }),
    ).resolves.toEqual({ status: "FAILED", errorCode: "REDIRECT_BLOCKED" });
    expect(external.urls).toEqual([ATTACHMENT]);
    expect(external.close).toHaveBeenCalledTimes(1);

    const login = scripted([redirect("/co/login/loginForm.do")]);
    await expect(
      createG2bAttachmentFetcher({ transport: login.transport }).fetch({
        name: "공고서.pdf",
        url: ATTACHMENT,
      }),
    ).resolves.toEqual({ status: "FAILED", errorCode: "AUTH_REQUIRED" });
    expect(login.urls).toHaveLength(1);
  });

  it("50 MiB 를 넘는 순간 받기를 멈추고 연결을 닫는다(선언 크기가 없어도)", async () => {
    let pulled = 0;
    async function* endless() {
      for (;;) {
        pulled += 1;
        yield new Uint8Array(MIB);
      }
    }
    const { transport, close } = scripted([
      { status: 200, location: null, contentLength: null, body: endless() },
    ]);

    await expect(
      createG2bAttachmentFetcher({ transport }).fetch({ name: "공고서.pdf", url: ATTACHMENT }),
    ).resolves.toEqual({ status: "FAILED", errorCode: "TOO_LARGE" });
    expect(pulled).toBe(51);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("같은 호스트 리다이렉트를 따라가 받은 본문의 형식은 매직 바이트로, sha256 은 본문으로 정한다", async () => {
    const { transport, urls } = scripted([
      redirect("/pn/pnp/pnpe/UntyAtchFile/downloadFile.do?fileSeq=1&retry=1"),
      {
        status: 200,
        location: null,
        contentLength: String(PDF.byteLength),
        body: chunksOf(PDF.slice(0, 4), PDF.slice(4)),
      },
    ]);

    const result = await createG2bAttachmentFetcher({ transport }).fetch({
      name: "공고서.hwpx",
      url: ATTACHMENT,
    });

    expect(urls).toHaveLength(2);
    expect(result).toMatchObject({
      status: "OK",
      format: "PDF",
      mimeType: "application/pdf",
      sizeBytes: PDF.byteLength,
      sha256: createHash("sha256").update(PDF).digest("hex"),
    });
  });
});
