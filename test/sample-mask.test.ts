import { describe, expect, it } from "vitest";
import {
  detectFormat,
  findLeaks,
  maskSample,
  secretVariants,
  summarize,
  trimItems,
} from "../scripts/lib/sample-mask.js";

const K = "Ab+c/d==XYZ123fake";
const OC = "ocuser9";

describe("sample-mask", () => {
  it("masks raw, encoded, form, lowercase and double-encoded forms", () => {
    const variants = secretVariants(K);
    const text = `all: ${variants.join(" | ")}`;
    const out = maskSample(text, [K]);
    expect(variants.filter((v) => out.includes(v))).toEqual([]);
    expect(findLeaks(out, [K])).toEqual([]);
  });

  it("masks OC in law links", () => {
    const link = "https://www.law.go.kr/DRF/lawService.do?OC=ocuser9&target=admrul";
    expect(maskSample(link, [])).toBe("https://www.law.go.kr/DRF/lawService.do?OC=***&target=admrul");
    expect(maskSample("&amp;oc=ocuser9&amp;", [])).toBe("&amp;oc=***&amp;");
    expect(maskSample(link, [OC])).toBe("https://www.law.go.kr/DRF/lawService.do?OC=***&target=admrul");
  });

  it("reports leaks without values", () => {
    expect(findLeaks(`x ${K} y`, [K])).toEqual(["secret#0:0"]);
    expect(findLeaks(`x ${K} y`, [K]).join(" ").includes(K)).toBe(false);
    expect(findLeaks("serviceKey=abc123", [])).toEqual(["param:servicekey"]);
    expect(findLeaks("OC=test", [])).toEqual([]);
  });

  it("heuristic only when enabled", () => {
    const hex = "0123456789abcdef".repeat(4);
    expect(findLeaks(hex, [])).toEqual([]);
    expect(findLeaks(hex, [], { heuristic: true })).toEqual(["hex64"]);
  });

  it("trims xml items preserving bytes", () => {
    const items = [1, 2, 3, 4, 5]
      .map((i) => `  <item>\n    <seq>${i}</seq>\n    ${i === 2 ? "<zip>0123</zip>" : ""}\n  </item>`)
      .join("\n");
    const xml = `<response>\n  <header>\n    <resultCode>00</resultCode>\n  </header>\n  <body>\n    <totalCount>5</totalCount>\n    <items>\n${items}\n    </items>\n  </body>\n</response>`;
    const r = trimItems(xml, "xml", 3);
    expect(r.after).toBe(3);
    expect(r.before).toBe(5);
    expect(r.text).toContain("<totalCount>5</totalCount>");
    expect(r.text).toContain("0123");
    expect(r.text).not.toContain("<seq>4</seq>");
    expect(r.text.slice(0, r.text.indexOf("<item>"))).toBe(xml.slice(0, xml.indexOf("<item>")));
  });

  it("trims json array by key", () => {
    const itemsArr = [1, 2, 3, 4, 5].map((i) => ({ seq: i }));
    const obj = { response: { body: { items: { item: itemsArr }, totalCount: 5 } } };
    const text = JSON.stringify(obj);
    const r = trimItems(text, "json", 3);
    expect(r.before).toBe(5);
    expect(r.after).toBe(3);
    const parsed = JSON.parse(r.text) as { response: { body: Record<string, unknown> } };
    expect(Object.keys(parsed.response.body)).toEqual(["items", "totalCount"]);
    expect((parsed.response.body.items as { item: unknown[] }).item).toHaveLength(3);

    const single = JSON.stringify({ response: { body: { items: { item: { seq: 1 } }, totalCount: 1 } } });
    expect(trimItems(single, "json", 3).text).toBe(single);
    expect(trimItems(text, "json", 0).text).toBe(text);
  });

  it("detects formats", () => {
    expect(detectFormat("<!doctype html><html></html>", "text/html")).toBe("html");
    expect(detectFormat("<?xml version=\"1.0\"?><a/>", "application/xml")).toBe("xml");
    expect(detectFormat("{\"a\":1}", "application/json")).toBe("json");
    expect(detectFormat("plain words", "text/plain")).toBe("text");
  });

  it("classifies", () => {
    expect(summarize("", null, "").classification).toBe("한도·장애");
    expect(summarize("", 503, "").classification).toBe("한도·장애");
    expect(
      summarize(
        "<OpenAPI_ServiceResponse><cmmMsgHeader><returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>",
        200,
        "application/xml",
      ).classification,
    ).toBe("미승인");
    expect(summarize("<returnReasonCode>22</returnReasonCode>", 200, "application/xml").classification).toBe("한도·장애");
    expect(summarize("<resultCode>00</resultCode>", 200, "application/xml").classification).toBe("확인됨");
    expect(summarize("사용자 정보 검증에 실패", 200, "text/plain").classification).toBe("미승인");
    expect(summarize("<!doctype html><html></html>", 200, "text/html").classification).toBe("기타 오류");
    expect(summarize("<error>x</error>", 500, "application/xml").classification).toBe("기타 오류");
  });
});
