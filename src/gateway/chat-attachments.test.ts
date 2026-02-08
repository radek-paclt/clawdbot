import { describe, expect, it } from "vitest";

import {
  buildMessageWithAttachments,
  type ChatAttachment,
  parseMessageWithAttachments,
} from "./chat-attachments.js";

const PNG_1x1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/woAAn8B9FD5fHAAAAAASUVORK5CYII=";

describe("buildMessageWithAttachments", () => {
  it("embeds a single image as data URL", () => {
    const msg = buildMessageWithAttachments("see this", [
      {
        type: "image",
        mimeType: "image/png",
        fileName: "dot.png",
        content: PNG_1x1,
      },
    ]);
    expect(msg).toContain("see this");
    expect(msg).toContain(`data:image/png;base64,${PNG_1x1}`);
    expect(msg).toContain("![dot.png]");
  });

  it("rejects non-image mime types", () => {
    const bad: ChatAttachment = {
      type: "file",
      mimeType: "application/pdf",
      fileName: "a.pdf",
      content: "AAA",
    };
    expect(() => buildMessageWithAttachments("x", [bad])).toThrow(/image/);
  });

  it("rejects invalid base64 content", () => {
    const bad: ChatAttachment = {
      type: "image",
      mimeType: "image/png",
      fileName: "dot.png",
      content: "%not-base64%",
    };
    expect(() => buildMessageWithAttachments("x", [bad])).toThrow(/base64/);
  });

  it("rejects images over limit", () => {
    const big = Buffer.alloc(6_000_000, 0).toString("base64");
    const att: ChatAttachment = {
      type: "image",
      mimeType: "image/png",
      fileName: "big.png",
      content: big,
    };
    expect(() => buildMessageWithAttachments("x", [att], { maxBytes: 5_000_000 })).toThrow(
      /exceeds size limit/i,
    );
  });
});

describe("parseMessageWithAttachments", () => {
  it("strips data URL prefix", async () => {
    const parsed = await parseMessageWithAttachments(
      "see this",
      [
        {
          type: "image",
          mimeType: "image/png",
          fileName: "dot.png",
          content: `data:image/png;base64,${PNG_1x1}`,
        },
      ],
      { log: { warn: () => {} } },
    );
    expect(parsed.images).toHaveLength(1);
    expect(parsed.images[0]?.mimeType).toBe("image/png");
    expect(parsed.images[0]?.data).toBe(PNG_1x1);
  });

  it("rejects invalid base64 content", async () => {
    await expect(
      parseMessageWithAttachments(
        "x",
        [
          {
            type: "image",
            mimeType: "image/png",
            fileName: "dot.png",
            content: "%not-base64%",
          },
        ],
        { log: { warn: () => {} } },
      ),
    ).rejects.toThrow(/base64/i);
  });

  it("rejects images over limit", async () => {
    const big = Buffer.alloc(6_000_000, 0).toString("base64");
    await expect(
      parseMessageWithAttachments(
        "x",
        [
          {
            type: "image",
            mimeType: "image/png",
            fileName: "big.png",
            content: big,
          },
        ],
        { maxBytes: 5_000_000, log: { warn: () => {} } },
      ),
    ).rejects.toThrow(/exceeds size limit/i);
  });

  it("sniffs mime when missing", async () => {
    const logs: string[] = [];
    const parsed = await parseMessageWithAttachments(
      "see this",
      [
        {
          type: "image",
          fileName: "dot.png",
          content: PNG_1x1,
        },
      ],
      { log: { warn: (message) => logs.push(message) } },
    );
    expect(parsed.message).toBe("see this");
    expect(parsed.images).toHaveLength(1);
    expect(parsed.images[0]?.mimeType).toBe("image/png");
    expect(parsed.images[0]?.data).toBe(PNG_1x1);
    expect(logs).toHaveLength(0);
  });

  it("accepts PDF payloads", async () => {
    const logs: string[] = [];
    const pdf = Buffer.from("%PDF-1.4\n").toString("base64");
    const parsed = await parseMessageWithAttachments(
      "x",
      [
        {
          type: "file",
          mimeType: "application/pdf",
          fileName: "document.pdf",
          content: pdf,
        },
      ],
      { log: { warn: (message) => logs.push(message) } },
    );
    expect(parsed.images).toHaveLength(1);
    expect(parsed.images[0]?.mimeType).toBe("application/pdf");
  });

  it("drops non-accepted payloads and logs", async () => {
    const logs: string[] = [];
    const zip = Buffer.from("PK\x03\x04not-a-real-zip").toString("base64");
    const parsed = await parseMessageWithAttachments(
      "x",
      [
        {
          type: "file",
          mimeType: "application/zip",
          fileName: "archive.zip",
          content: zip,
        },
      ],
      { log: { warn: (message) => logs.push(message) } },
    );
    expect(parsed.images).toHaveLength(0);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/non-accepted/i);
  });

  it("prefers sniffed mime type and logs mismatch", async () => {
    const logs: string[] = [];
    const parsed = await parseMessageWithAttachments(
      "x",
      [
        {
          type: "image",
          mimeType: "image/jpeg",
          fileName: "dot.png",
          content: PNG_1x1,
        },
      ],
      { log: { warn: (message) => logs.push(message) } },
    );
    expect(parsed.images).toHaveLength(1);
    expect(parsed.images[0]?.mimeType).toBe("image/png");
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/mime mismatch/i);
  });

  it("drops unknown mime when sniff fails and logs", async () => {
    const logs: string[] = [];
    const unknown = Buffer.from("not an image").toString("base64");
    const parsed = await parseMessageWithAttachments(
      "x",
      [{ type: "file", fileName: "unknown.bin", content: unknown }],
      { log: { warn: (message) => logs.push(message) } },
    );
    expect(parsed.images).toHaveLength(0);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/unable to detect accepted mime type/i);
  });

  it("keeps valid images/PDFs and drops non-accepted ones", async () => {
    const logs: string[] = [];
    const unknown = Buffer.from("not-a-known-type").toString("base64");
    const parsed = await parseMessageWithAttachments(
      "x",
      [
        {
          type: "image",
          mimeType: "image/png",
          fileName: "dot.png",
          content: PNG_1x1,
        },
        {
          type: "file",
          mimeType: "application/octet-stream",
          fileName: "random.bin",
          content: unknown,
        },
      ],
      { log: { warn: (message) => logs.push(message) } },
    );
    expect(parsed.images).toHaveLength(1);
    expect(parsed.images[0]?.mimeType).toBe("image/png");
    expect(parsed.images[0]?.data).toBe(PNG_1x1);
    expect(logs.some((l) => /non-accepted/i.test(l) || /unable to detect/i.test(l))).toBe(true);
  });
});
