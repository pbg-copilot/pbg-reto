import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { buildXlsx } from "../src/lib/xlsx.js";

describe("T007.17 xlsx writer", () => {
  const sheetOf = (file: Uint8Array, n = 1) => strFromU8(unzipSync(file)[`xl/worksheets/sheet${n}.xml`]!);

  it("writes text as text: a value that looks like a formula is never a formula", () => {
    const file = buildXlsx([{ name: "Datos", columns: [{ header: "Título" }], rows: [['=HYPERLINK("http://x","clic")'], ["+1-1"], ["@SUM(A1)"]] }]);
    const sheet = sheetOf(file);
    expect(sheet).not.toContain("<f>");
    expect(sheet).toContain('t="inlineStr"');
    expect(sheet).toContain("=HYPERLINK(&quot;http://x&quot;,&quot;clic&quot;)");
  });

  it("keeps numbers and dates typed, escapes XML and drops control characters", () => {
    const file = buildXlsx([{ name: "Datos", columns: [{ header: "a" }, { header: "b" }, { header: "c" }], rows: [[42.5, new Date("2026-01-01T12:00:00Z"), "<b>&\u0007"]] }]);
    const sheet = sheetOf(file);
    expect(sheet).toContain('<c r="A2"><v>42.5</v></c>');
    // 2026-01-01 12:00 UTC = 46023.5 en días de Excel, con el estilo de fecha.
    expect(sheet).toContain('<c r="B2" s="2"><v>46023.5</v></c>');
    expect(sheet).toContain("&lt;b&gt;&amp;</t>");
  });

  it("names columns past Z and cleans sheet names", () => {
    const columns = Array.from({ length: 28 }, (_, i) => ({ header: `c${i}` }));
    const file = buildXlsx([{ name: "Rango: 1/3 [a]", columns, rows: [] }]);
    expect(sheetOf(file)).toContain('r="AB1"');
    expect(strFromU8(unzipSync(file)["xl/workbook.xml"]!)).toContain('name="Rango  1 3  a "');
  });
});
