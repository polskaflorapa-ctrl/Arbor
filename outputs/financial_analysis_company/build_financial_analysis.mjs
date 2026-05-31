import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const outputDir = "C:/Users/paha1/arbor/outputs/financial_analysis_company";
await fs.mkdir(outputDir, { recursive: true });

const workbook = Workbook.create();

const sheets = {
  cover: workbook.worksheets.add("Dashboard"),
  assumptions: workbook.worksheets.add("Assumptions"),
  historicals: workbook.worksheets.add("Historical Financials"),
  forecast: workbook.worksheets.add("Forecast Model"),
  valuation: workbook.worksheets.add("DCF Valuation"),
  sensitivity: workbook.worksheets.add("Sensitivity"),
  checks: workbook.worksheets.add("Checks"),
  sources: workbook.worksheets.add("Sources & Audit"),
};

const palette = {
  navy: "#17324D",
  blue: "#1F6FEB",
  teal: "#0F766E",
  gold: "#F2C94C",
  green: "#16803C",
  red: "#B42318",
  paleBlue: "#EAF2FF",
  paleTeal: "#E7F5F1",
  paleGold: "#FFF7D6",
  paleRed: "#FDECEC",
  gray1: "#F7F9FC",
  gray2: "#E6EAF0",
  gray3: "#64748B",
  black: "#111827",
  white: "#FFFFFF",
};

const fmt = {
  money: "$#,##0;[Red]($#,##0);-",
  percent: "0.0%;[Red](0.0%);-",
  multiple: "0.0x;[Red](0.0x);-",
  number: "#,##0;[Red](#,##0);-",
  perShare: "$0.00;[Red]($0.00);-",
};

function applyBase(sheet) {
  sheet.showGridLines = false;
  sheet.getRange("A:Z").format = { font: { name: "Aptos", size: 10, color: palette.black } };
}

for (const sheet of Object.values(sheets)) applyBase(sheet);

function title(sheet, range, text, subtitle = "") {
  sheet.getRange(range).merge();
  const cell = sheet.getRange(range.split(":")[0]);
  cell.values = [[text]];
  cell.format = {
    fill: palette.navy,
    font: { bold: true, color: palette.white, size: 16 },
    horizontalAlignment: "left",
    verticalAlignment: "center",
  };
  sheet.getRange(range).format.rowHeightPx = 34;
  if (subtitle) {
    const row = Number(range.match(/\d+/)[0]) + 1;
    sheet.getRange(`A${row}:H${row}`).merge();
    sheet.getRange(`A${row}`).values = [[subtitle]];
    sheet.getRange(`A${row}:H${row}`).format = {
      fill: palette.gray1,
      font: { italic: true, color: palette.gray3, size: 10 },
      horizontalAlignment: "left",
      verticalAlignment: "center",
    };
  }
}

function section(sheet, range, text, color = palette.teal) {
  sheet.getRange(range).merge();
  const cell = sheet.getRange(range.split(":")[0]);
  cell.values = [[text]];
  sheet.getRange(range).format = {
    fill: color,
    font: { bold: true, color: palette.white },
    horizontalAlignment: "left",
    verticalAlignment: "center",
  };
}

function setWidths(sheet, widths) {
  widths.forEach((width, i) => {
    sheet.getCell(0, i).format.columnWidthPx = width;
  });
}

function header(range) {
  range.format = {
    fill: palette.navy,
    font: { bold: true, color: palette.white },
    horizontalAlignment: "center",
    verticalAlignment: "center",
    wrapText: true,
  };
}

function body(range) {
  range.format = {
    fill: palette.white,
    borders: { insideHorizontal: { style: "continuous", color: palette.gray2 }, insideVertical: { style: "continuous", color: palette.gray2 } },
  };
}

function inputStyle(range) {
  range.format = { fill: palette.paleGold, font: { color: "#0000FF" } };
}

function formulaStyle(range) {
  range.format = { font: { color: "#000000" } };
}

function linkedFormulaStyle(range) {
  range.format = { font: { color: "#008000" } };
}

// Assumptions
const a = sheets.assumptions;
setWidths(a, [190, 130, 120, 120, 120, 120, 120, 120, 140, 220]);
title(a, "A1:J1", "Financial Analysis Assumptions", "Replace the yellow input cells with company-specific data from filings, investor materials, and market data.");
section(a, "A4:J4", "Model Conventions");
a.getRange("A5:J13").values = [
  ["Company Name", "ExampleCo Inc.", "", "Currency", "USD", "", "Units", "$mm", "", ""],
  ["Ticker", "EXCO", "", "Valuation Date", new Date(2026, 4, 31), "", "Fiscal Year End", "Dec 31", "", ""],
  ["Scenario", "Base Case", "", "Forecast Years", 5, "", "Terminal Method", "Gordon Growth", "", ""],
  ["Source Data Status", "Illustrative placeholder data", "", "Discounting Convention", "Mid-year", "", "Model Owner", "ChatGPT", "", ""],
  ["", "", "", "", "", "", "", "", "", ""],
  ["Legend", "Blue font = hardcoded inputs", "Green font = sheet links", "Black font = formulas", "Yellow fill = user update", "", "", "", "", ""],
  ["", "", "", "", "", "", "", "", "", ""],
  ["Note", "This workbook is a template because no specific company or filings were provided in the prompt.", "", "", "", "", "", "", "", ""],
  ["", "", "", "", "", "", "", "", "", ""],
];
a.getRange("B5:B8").format = { fill: palette.paleGold, font: { color: "#0000FF", bold: true } };
a.getRange("E5:E8").format = { fill: palette.paleGold, font: { color: "#0000FF" } };
a.getRange("H5:H8").format = { fill: palette.paleGold, font: { color: "#0000FF" } };
a.getRange("E6").setNumberFormat("yyyy-mm-dd");
a.getRange("A5:H12").format.wrapText = true;
section(a, "A15:J15", "Forecast Drivers");
a.getRange("A16:J24").values = [
  ["Driver", "2027E", "2028E", "2029E", "2030E", "2031E", "", "Bear", "Base", "Bull"],
  ["Revenue Growth", 0.08, 0.075, 0.07, 0.065, 0.06, "", 0.045, 0.065, 0.085],
  ["Gross Margin", 0.48, 0.485, 0.49, 0.495, 0.50, "", 0.47, 0.495, 0.515],
  ["SG&A % Revenue", 0.22, 0.215, 0.21, 0.205, 0.20, "", 0.23, 0.205, 0.19],
  ["R&D % Revenue", 0.09, 0.088, 0.086, 0.084, 0.082, "", 0.095, 0.084, 0.075],
  ["D&A % Revenue", 0.035, 0.034, 0.033, 0.032, 0.031, "", 0.035, 0.032, 0.030],
  ["Capex % Revenue", 0.055, 0.054, 0.053, 0.052, 0.050, "", 0.060, 0.052, 0.047],
  ["NWC % Revenue", 0.12, 0.118, 0.116, 0.114, 0.112, "", 0.125, 0.114, 0.105],
  ["Cash Tax Rate", 0.22, 0.22, 0.22, 0.22, 0.22, "", 0.24, 0.22, 0.20],
];
header(a.getRange("A16:J16"));
body(a.getRange("A17:J24"));
inputStyle(a.getRange("B17:F24"));
inputStyle(a.getRange("H17:J24"));
a.getRange("B17:J24").setNumberFormat(fmt.percent);
section(a, "A27:J27", "Valuation Assumptions");
a.getRange("A28:J36").values = [
  ["Assumption", "Base Case", "Low", "High", "", "Assumption", "Base Case", "Low", "High", ""],
  ["WACC", 0.095, 0.085, 0.105, "", "Terminal Growth", 0.025, 0.015, 0.035, ""],
  ["Exit EBITDA Multiple", 11.0, 9.0, 13.0, "", "Cash & Equivalents", 520, 450, 600, ""],
  ["Debt", 980, 900, 1050, "", "Diluted Shares", 210, 200, 220, ""],
  ["Minority Interest", 0, 0, 0, "", "Investments / Other Assets", 75, 50, 100, ""],
  ["", "", "", "", "", "", "", "", "", ""],
  ["Source Note", "Replace with latest market data and balance sheet values.", "", "", "", "", "", "", "", ""],
  ["", "", "", "", "", "", "", "", "", ""],
  ["", "", "", "", "", "", "", "", "", ""],
];
header(a.getRange("A28:J28"));
body(a.getRange("A29:J34"));
inputStyle(a.getRange("B29:D33"));
inputStyle(a.getRange("G29:I33"));
a.getRange("B29:D29").setNumberFormat(fmt.percent);
a.getRange("G29:I29").setNumberFormat(fmt.percent);
a.getRange("B30:D30").setNumberFormat(fmt.multiple);
a.getRange("B31:D33").setNumberFormat(fmt.money);
a.getRange("G30:I33").setNumberFormat(fmt.money);
a.getRange("G31:I31").setNumberFormat(fmt.number);
a.freezePanes.freezeRows(4);

// Historical Financials
const h = sheets.historicals;
setWidths(h, [220, 95, 95, 95, 95, 95, 120, 200]);
title(h, "A1:H1", "Historical Financials", "Illustrative historicals. Replace with company-reported financial statements.");
section(h, "A4:H4", "Income Statement and Cash Flow Inputs");
h.getRange("A5:H20").values = [
  ["Metric ($mm except per-share)", "2022A", "2023A", "2024A", "2025A", "2026A", "Source ID", "Notes"],
  ["Revenue", 3200, 3550, 3920, 4360, 4820, "SRC-001", "Reported revenue"],
  ["Gross Profit", 1440, 1633, 1842, 2093, 2323, "SRC-001", "Revenue less cost of goods sold"],
  ["SG&A", -760, -820, -910, -990, -1060, "SRC-001", "Operating expense"],
  ["R&D", -270, -305, -345, -386, -425, "SRC-001", "Operating expense"],
  ["EBITDA", 560, 650, 760, 870, 1000, "SRC-001", "Company / analyst adjusted EBITDA"],
  ["D&A", -110, -122, -137, -150, -166, "SRC-001", "Depreciation and amortization"],
  ["EBIT", 450, 528, 623, 720, 834, "SRC-001", "EBITDA less D&A"],
  ["Cash Taxes", -88, -112, -136, -158, -183, "SRC-001", "Cash taxes paid / estimated"],
  ["Capex", -190, -205, -226, -245, -268, "SRC-001", "Capital expenditures"],
  ["Net Working Capital", 400, 430, 455, 505, 550, "SRC-001", "Operating NWC balance"],
  ["Change in NWC", "", "", "", "", "", "Calc", "Year-over-year change in operating NWC"],
  ["Unlevered FCF", "", "", "", "", "", "Calc", "EBIT less cash taxes plus D&A less capex less change in NWC"],
  ["Cash & Equivalents", 410, 450, 480, 500, 520, "SRC-002", "Balance sheet cash"],
  ["Debt", 900, 950, 1010, 995, 980, "SRC-002", "Short- and long-term debt"],
  ["Diluted Shares", 225, 220, 216, 213, 210, "SRC-003", "Diluted weighted shares"],
];
header(h.getRange("A5:H5"));
body(h.getRange("A6:H20"));
inputStyle(h.getRange("B6:F16"));
h.getRange("B16:F16").formulas = [["=B15-B15", "=C15-B15", "=D15-C15", "=E15-D15", "=F15-E15"]];
h.getRange("B17:F17").formulas = [["=B12+B13-B11+B14-B16", "=C12+C13-C11+C14-C16", "=D12+D13-D11+D14-D16", "=E12+E13-E11+E14-E16", "=F12+F13-F11+F14-F16"]];
formulaStyle(h.getRange("B16:F17"));
h.getRange("B6:F20").setNumberFormat(fmt.money);
h.getRange("B20:F20").setNumberFormat(fmt.number);
h.getRange("G6:H20").format = { font: { color: palette.gray3 }, wrapText: true };
h.getRange("A23:H30").values = [
  ["Metric", "2022A", "2023A", "2024A", "2025A", "2026A", "Source ID", "Notes"],
  ["Revenue Growth", "", "", "", "", "", "Calc", ""],
  ["Gross Margin", "", "", "", "", "", "Calc", ""],
  ["EBITDA Margin", "", "", "", "", "", "Calc", ""],
  ["EBIT Margin", "", "", "", "", "", "Calc", ""],
  ["FCF Margin", "", "", "", "", "", "Calc", ""],
  ["Capex % Revenue", "", "", "", "", "", "Calc", ""],
  ["NWC % Revenue", "", "", "", "", "", "Calc", ""],
];
header(h.getRange("A23:H23"));
body(h.getRange("A24:H30"));
h.getRange("B24:F30").formulas = [
  ["=IFERROR(B6/NA(),\"\")", "=C6/B6-1", "=D6/C6-1", "=E6/D6-1", "=F6/E6-1"],
  ["=B7/B6", "=C7/C6", "=D7/D6", "=E7/E6", "=F7/F6"],
  ["=B11/B6", "=C11/C6", "=D11/D6", "=E11/E6", "=F11/F6"],
  ["=B13/B6", "=C13/C6", "=D13/D6", "=E13/E6", "=F13/F6"],
  ["=B18/B6", "=C18/C6", "=D18/D6", "=E18/E6", "=F18/F6"],
  ["=-B15/B6", "=-C15/C6", "=-D15/D6", "=-E15/E6", "=-F15/F6"],
  ["=B16/B6", "=C16/C6", "=D16/D6", "=E16/E6", "=F16/F6"],
];
formulaStyle(h.getRange("B24:F30"));
h.getRange("B24:F30").setNumberFormat(fmt.percent);
h.freezePanes.freezeRows(5);
h.freezePanes.freezeColumns(1);

// Forecast Model
const f = sheets.forecast;
setWidths(f, [230, 95, 95, 95, 95, 95, 95, 130, 200]);
title(f, "A1:I1", "Forecast Model", "Forecasts are formula-driven from Historical Financials and Assumptions.");
section(f, "A4:I4", "Operating Forecast");
f.getRange("A5:I22").values = [
  ["Metric ($mm)", "2026A", "2027E", "2028E", "2029E", "2030E", "2031E", "Formula / Source", "Notes"],
  ["Revenue", "", "", "", "", "", "", "Hist + growth drivers", ""],
  ["Revenue Growth", "", "", "", "", "", "", "Assumptions row 17", ""],
  ["Gross Profit", "", "", "", "", "", "", "Revenue x gross margin", ""],
  ["Gross Margin", "", "", "", "", "", "", "Assumptions row 18", ""],
  ["SG&A", "", "", "", "", "", "", "Revenue x SG&A %", ""],
  ["SG&A % Revenue", "", "", "", "", "", "", "Assumptions row 19", ""],
  ["R&D", "", "", "", "", "", "", "Revenue x R&D %", ""],
  ["R&D % Revenue", "", "", "", "", "", "", "Assumptions row 20", ""],
  ["EBITDA", "", "", "", "", "", "", "Gross profit less opex", ""],
  ["EBITDA Margin", "", "", "", "", "", "", "EBITDA / revenue", ""],
  ["D&A", "", "", "", "", "", "", "Revenue x D&A %", ""],
  ["EBIT", "", "", "", "", "", "", "EBITDA less D&A", ""],
  ["Cash Taxes", "", "", "", "", "", "", "EBIT x cash tax rate", ""],
  ["Capex", "", "", "", "", "", "", "Revenue x capex %", ""],
  ["Net Working Capital", "", "", "", "", "", "", "Revenue x NWC %", ""],
  ["Change in NWC", "", "", "", "", "", "", "Year-over-year change", ""],
  ["Unlevered FCF", "", "", "", "", "", "", "EBIT + cash taxes - D&A + capex - change in NWC", ""],
];
header(f.getRange("A5:I5"));
body(f.getRange("A6:I22"));
f.getRange("B6:B22").formulas = [
  ["='Historical Financials'!F6"],
  ["='Historical Financials'!F24"],
  ["='Historical Financials'!F7"],
  ["='Historical Financials'!F25"],
  ["='Historical Financials'!F8"],
  ["=-B10/B6"],
  ["='Historical Financials'!F9"],
  ["=-B12/B6"],
  ["='Historical Financials'!F10"],
  ["=B14/B6"],
  ["='Historical Financials'!F11"],
  ["='Historical Financials'!F12"],
  ["='Historical Financials'!F13"],
  ["='Historical Financials'!F14"],
  ["='Historical Financials'!F15"],
  ["='Historical Financials'!F16"],
  ["='Historical Financials'!F17"],
];
linkedFormulaStyle(f.getRange("B6:B22"));
f.getRange("C6:G22").formulas = [
  ["=B6*(1+C7)", "=C6*(1+D7)", "=D6*(1+E7)", "=E6*(1+F7)", "=F6*(1+G7)"],
  ["='Assumptions'!B17", "='Assumptions'!C17", "='Assumptions'!D17", "='Assumptions'!E17", "='Assumptions'!F17"],
  ["=C6*C9", "=D6*D9", "=E6*E9", "=F6*F9", "=G6*G9"],
  ["='Assumptions'!B18", "='Assumptions'!C18", "='Assumptions'!D18", "='Assumptions'!E18", "='Assumptions'!F18"],
  ["=-C6*C11", "=-D6*D11", "=-E6*E11", "=-F6*F11", "=-G6*G11"],
  ["='Assumptions'!B19", "='Assumptions'!C19", "='Assumptions'!D19", "='Assumptions'!E19", "='Assumptions'!F19"],
  ["=-C6*C13", "=-D6*D13", "=-E6*E13", "=-F6*F13", "=-G6*G13"],
  ["='Assumptions'!B20", "='Assumptions'!C20", "='Assumptions'!D20", "='Assumptions'!E20", "='Assumptions'!F20"],
  ["=C8+C10+C12", "=D8+D10+D12", "=E8+E10+E12", "=F8+F10+F12", "=G8+G10+G12"],
  ["=C14/C6", "=D14/D6", "=E14/E6", "=F14/F6", "=G14/G6"],
  ["=-C6*'Assumptions'!B21", "=-D6*'Assumptions'!C21", "=-E6*'Assumptions'!D21", "=-F6*'Assumptions'!E21", "=-G6*'Assumptions'!F21"],
  ["=C14+C16", "=D14+D16", "=E14+E16", "=F14+F16", "=G14+G16"],
  ["=-C17*'Assumptions'!B24", "=-D17*'Assumptions'!C24", "=-E17*'Assumptions'!D24", "=-F17*'Assumptions'!E24", "=-G17*'Assumptions'!F24"],
  ["=-C6*'Assumptions'!B22", "=-D6*'Assumptions'!C22", "=-E6*'Assumptions'!D22", "=-F6*'Assumptions'!E22", "=-G6*'Assumptions'!F22"],
  ["=C6*'Assumptions'!B23", "=D6*'Assumptions'!C23", "=E6*'Assumptions'!D23", "=F6*'Assumptions'!E23", "=G6*'Assumptions'!F23"],
  ["=C20-B20", "=D20-C20", "=E20-D20", "=F20-E20", "=G20-F20"],
  ["=C17+C18-C16+C19-C21", "=D17+D18-D16+D19-D21", "=E17+E18-E16+E19-E21", "=F17+F18-F16+F19-F21", "=G17+G18-G16+G19-G21"],
];
formulaStyle(f.getRange("C6:G22"));
f.getRange("B6:G22").setNumberFormat(fmt.money);
f.getRange("B7:G7").setNumberFormat(fmt.percent);
f.getRange("B9:G9").setNumberFormat(fmt.percent);
f.getRange("B11:G11").setNumberFormat(fmt.percent);
f.getRange("B13:G13").setNumberFormat(fmt.percent);
f.getRange("B15:G15").setNumberFormat(fmt.percent);
f.getRange("H6:I22").format = { font: { color: palette.gray3 }, wrapText: true };
f.freezePanes.freezeRows(5);
f.freezePanes.freezeColumns(1);

// DCF Valuation
const v = sheets.valuation;
setWidths(v, [230, 100, 100, 100, 100, 100, 120, 120, 180]);
title(v, "A1:I1", "DCF Valuation", "Enterprise value, equity value, and implied share price based on forecast free cash flow.");
section(v, "A4:I4", "DCF Build");
v.getRange("A5:I23").values = [
  ["Metric", "2027E", "2028E", "2029E", "2030E", "2031E", "Terminal", "Source", "Notes"],
  ["Unlevered FCF", "", "", "", "", "", "", "Forecast Model", ""],
  ["WACC", "", "", "", "", "", "", "Assumptions", ""],
  ["Discount Factor", "", "", "", "", "", "", "Mid-year convention", ""],
  ["PV of FCF", "", "", "", "", "", "", "FCF x discount factor", ""],
  ["Terminal Growth", "", "", "", "", "", "", "Assumptions", ""],
  ["Terminal Value", "", "", "", "", "", "", "Gordon Growth", ""],
  ["PV of Terminal Value", "", "", "", "", "", "", "Terminal value x FY5 discount factor", ""],
  ["", "", "", "", "", "", "", "", ""],
  ["Enterprise Value", "", "", "", "", "", "", "Sum PVs", ""],
  ["Cash & Equivalents", "", "", "", "", "", "", "Assumptions", ""],
  ["Debt", "", "", "", "", "", "", "Assumptions", ""],
  ["Minority Interest", "", "", "", "", "", "", "Assumptions", ""],
  ["Investments / Other Assets", "", "", "", "", "", "", "Assumptions", ""],
  ["Equity Value", "", "", "", "", "", "", "EV + cash - debt - MI + investments", ""],
  ["Diluted Shares", "", "", "", "", "", "", "Assumptions", ""],
  ["Implied Share Price", "", "", "", "", "", "", "Equity value / shares", ""],
  ["Exit EBITDA Multiple", "", "", "", "", "", "", "EV / FY5 EBITDA", ""],
  ["FCF Yield on EV", "", "", "", "", "", "", "FY1 FCF / EV", ""],
];
header(v.getRange("A5:I5"));
body(v.getRange("A6:I23"));
v.getRange("B6:F6").formulas = [["='Forecast Model'!C22", "='Forecast Model'!D22", "='Forecast Model'!E22", "='Forecast Model'!F22", "='Forecast Model'!G22"]];
v.getRange("B7:F7").formulas = [["='Assumptions'!B29", "='Assumptions'!B29", "='Assumptions'!B29", "='Assumptions'!B29", "='Assumptions'!B29"]];
v.getRange("B8:F8").formulas = [["=1/(1+B7)^0.5", "=1/(1+C7)^1.5", "=1/(1+D7)^2.5", "=1/(1+E7)^3.5", "=1/(1+F7)^4.5"]];
v.getRange("B9:F9").formulas = [["=B6*B8", "=C6*C8", "=D6*D8", "=E6*E8", "=F6*F8"]];
v.getRange("B10:F10").formulas = [["='Assumptions'!G29", "='Assumptions'!G29", "='Assumptions'!G29", "='Assumptions'!G29", "='Assumptions'!G29"]];
v.getRange("G11").formulas = [["=F6*(1+F10)/(F7-F10)"]];
v.getRange("G12").formulas = [["=G11*F8"]];
v.getRange("B14").formulas = [["=SUM(B9:F9)+G12"]];
v.getRange("B15").formulas = [["='Assumptions'!G30"]];
v.getRange("B16").formulas = [["='Assumptions'!B31"]];
v.getRange("B17").formulas = [["='Assumptions'!B32"]];
v.getRange("B18").formulas = [["='Assumptions'!G32"]];
v.getRange("B19").formulas = [["=B14+B15-B16-B17+B18"]];
v.getRange("B20").formulas = [["='Assumptions'!G31"]];
v.getRange("B21").formulas = [["=B19/B20"]];
v.getRange("B22").formulas = [["=B14/'Forecast Model'!G14"]];
v.getRange("B23").formulas = [["='Forecast Model'!C22/B14"]];
linkedFormulaStyle(v.getRange("B6:F7"));
formulaStyle(v.getRange("B8:G23"));
v.getRange("B6:G6").setNumberFormat(fmt.money);
v.getRange("B7:G7").setNumberFormat(fmt.percent);
v.getRange("B8:G8").setNumberFormat("0.000x");
v.getRange("B9:G9").setNumberFormat(fmt.money);
v.getRange("B10:G10").setNumberFormat(fmt.percent);
v.getRange("B11:G12").setNumberFormat(fmt.money);
v.getRange("B14:B19").setNumberFormat(fmt.money);
v.getRange("B20").setNumberFormat(fmt.number);
v.getRange("B21").setNumberFormat(fmt.perShare);
v.getRange("B22").setNumberFormat(fmt.multiple);
v.getRange("B23").setNumberFormat(fmt.percent);
v.getRange("H6:I23").format = { font: { color: palette.gray3 }, wrapText: true };
v.freezePanes.freezeRows(5);

// Sensitivity
const s = sheets.sensitivity;
setWidths(s, [180, 95, 95, 95, 95, 95, 95, 95, 180]);
title(s, "A1:I1", "Valuation Sensitivity", "Implied share price sensitivity to WACC and terminal growth assumptions.");
section(s, "A4:I4", "DCF Sensitivity - Share Price");
s.getRange("A5:G11").values = [
  ["Terminal Growth \\ WACC", 0.085, 0.09, 0.095, 0.10, 0.105, 0.11],
  [0.015, "", "", "", "", "", ""],
  [0.020, "", "", "", "", "", ""],
  [0.025, "", "", "", "", "", ""],
  [0.030, "", "", "", "", "", ""],
  [0.035, "", "", "", "", "", ""],
  [0.040, "", "", "", "", "", ""],
];
header(s.getRange("A5:G5"));
body(s.getRange("A6:G11"));
s.getRange("A6:A11").setNumberFormat(fmt.percent);
s.getRange("B5:G5").setNumberFormat(fmt.percent);
const sensFormulas = [];
for (let r = 6; r <= 11; r++) {
  const row = [];
  for (let c = 2; c <= 7; c++) {
    const col = String.fromCharCode(64 + c);
    row.push(`=((SUM('DCF Valuation'!$B$9:$F$9)+('DCF Valuation'!$F$6*(1+$A${r})/(${col}$5-$A${r})*'DCF Valuation'!$F$8))+'Assumptions'!$G$30-'Assumptions'!$B$31-'Assumptions'!$B$32+'Assumptions'!$G$32)/'Assumptions'!$G$31`);
  }
  sensFormulas.push(row);
}
s.getRange("B6:G11").formulas = sensFormulas;
s.getRange("B6:G11").setNumberFormat(fmt.perShare);
formulaStyle(s.getRange("B6:G11"));
s.getRange("I5:I10").values = [
  ["Scenario"],
  ["Bear"],
  ["Base"],
  ["Bull"],
  ["Model Status"],
  ["Current Implied Share Price"],
];
s.getRange("J5:J10").formulas = [
  [""],
  ["=INDEX(B6:G11,1,6)"],
  ["='DCF Valuation'!B21"],
  ["=INDEX(B6:G11,6,1)"],
  ["=Checks!F12"],
  ["='DCF Valuation'!B21"],
];
header(s.getRange("I5:J5"));
body(s.getRange("I6:J10"));
s.getRange("J6:J8").setNumberFormat(fmt.perShare);
s.getRange("J10").setNumberFormat(fmt.perShare);
formulaStyle(s.getRange("J6:J10"));

// Checks
const c = sheets.checks;
setWidths(c, [230, 120, 120, 120, 90, 260]);
title(c, "A1:F1", "Model Checks", "Each check should read OK before using the model for decisions.");
c.getRange("A4:F12").values = [
  ["Check", "Actual", "Expected", "Difference", "Status", "Notes"],
  ["Historical FCF formula tie", "", "", "", "", "FY2026 FCF should tie to formula components"],
  ["Forecast FCF formula tie", "", "", "", "", "FY2031 FCF should tie to formula components"],
  ["Terminal growth below WACC", "", "", "", "", "Gordon Growth terminal value requires WACC > terminal growth"],
  ["Enterprise value bridge", "", "", "", "", "EV should equal PV of forecast FCF plus PV terminal value"],
  ["Equity value bridge", "", "", "", "", "Equity value bridge should tie to valuation rows"],
  ["Shares positive", "", "", "", "", "Diluted share count must be greater than zero"],
  ["No missing key assumptions", "", "", "", "", "WACC, terminal growth, cash, debt, shares populated"],
  ["Overall Model Status", "", "", "", "", "Aggregates all above checks"],
];
header(c.getRange("A4:F4"));
body(c.getRange("A5:F12"));
c.getRange("B5:E12").formulas = [
  ["='Historical Financials'!F17", "='Historical Financials'!F12+'Historical Financials'!F13-'Historical Financials'!F11+'Historical Financials'!F14-'Historical Financials'!F16", "=B5-C5", "=IF(ABS(D5)<0.1,\"OK\",\"Check\")"],
  ["='Forecast Model'!G22", "='Forecast Model'!G17+'Forecast Model'!G18-'Forecast Model'!G16+'Forecast Model'!G19-'Forecast Model'!G21", "=B6-C6", "=IF(ABS(D6)<0.1,\"OK\",\"Check\")"],
  ["='Assumptions'!B29", "='Assumptions'!G29", "=B7-C7", "=IF(B7>C7,\"OK\",\"Check\")"],
  ["='DCF Valuation'!B14", "=SUM('DCF Valuation'!B9:F9)+'DCF Valuation'!G12", "=B8-C8", "=IF(ABS(D8)<0.1,\"OK\",\"Check\")"],
  ["='DCF Valuation'!B19", "='DCF Valuation'!B14+'DCF Valuation'!B15-'DCF Valuation'!B16-'DCF Valuation'!B17+'DCF Valuation'!B18", "=B9-C9", "=IF(ABS(D9)<0.1,\"OK\",\"Check\")"],
  ["='Assumptions'!G31", "0", "=B10-C10", "=IF(B10>0,\"OK\",\"Check\")"],
  ["=COUNTBLANK('Assumptions'!B29:B32)+COUNTBLANK('Assumptions'!G29:G32)", "0", "=B11-C11", "=IF(B11=0,\"OK\",\"Check\")"],
  ["=COUNTIF(E5:E11,\"OK\")", "7", "=B12-C12", "=IF(B12=C12,\"OK\",\"Check\")"],
];
formulaStyle(c.getRange("B5:E12"));
c.getRange("B5:D12").setNumberFormat(fmt.number);
c.getRange("E5:E12").conditionalFormats.add("containsText", { text: "OK", format: { fill: palette.paleTeal, font: { bold: true, color: palette.green } } });
c.getRange("E5:E12").conditionalFormats.add("containsText", { text: "Check", format: { fill: palette.paleRed, font: { bold: true, color: palette.red } } });
c.freezePanes.freezeRows(4);

// Sources
const src = sheets.sources;
setWidths(src, [90, 230, 120, 120, 220, 340, 340]);
title(src, "A1:G1", "Sources & Audit Trail", "Replace placeholder rows with actual filings, transcripts, investor decks, and market data links.");
src.getRange("A4:G11").values = [
  ["Source ID", "Item", "Period / As Of", "Units", "Source Name", "Plain-Text URL", "Notes"],
  ["SRC-001", "Historical financial statements", "FY2022-FY2026", "$mm", "Company annual reports / 10-K", "Add company filing URL here", "Illustrative values in this template are not source-backed."],
  ["SRC-002", "Cash and debt", "FY2026", "$mm", "Company balance sheet", "Add company balance sheet URL here", "Use latest reported balance sheet."],
  ["SRC-003", "Diluted shares", "FY2026", "mm shares", "Company annual report / 10-K", "Add company share count source URL here", "Use diluted weighted average or current diluted shares consistently."],
  ["SRC-004", "Market data", "Valuation date", "Various", "Market data provider", "Add market data URL here", "Update cash, debt, shares, WACC assumptions."],
  ["SRC-005", "Peer valuation", "Valuation date", "x", "Comparable company set", "Add peer comp source URL here", "Optional support for exit multiple."],
  ["", "", "", "", "", "", ""],
  ["Audit Note", "No specific company name, ticker, or financial filings were provided in the prompt.", "", "", "", "", "Workbook is prepared as an editable template with example placeholder data."],
];
header(src.getRange("A4:G4"));
body(src.getRange("A5:G11"));
inputStyle(src.getRange("F5:F9"));
src.getRange("A5:G11").format.wrapText = true;

// Dashboard
const d = sheets.cover;
setWidths(d, [190, 115, 115, 115, 125, 115, 135, 115, 135, 115, 155, 120]);
title(d, "A1:L1", "Company Financial Analysis Dashboard", "Editable model template with illustrative data. Update Assumptions, Historical Financials, and Sources & Audit for the target company.");
section(d, "A4:L4", "Executive KPIs");
d.getRange("A5:L8").values = [
  ["Company", "", "Scenario", "", "Model Status", "", "Enterprise Value", "", "Equity Value", "", "Implied Share Price", ""],
  ["", "", "", "", "", "", "", "", "", "", "", ""],
  ["Revenue CAGR 2026A-2031E", "", "EBITDA Margin 2031E", "", "FCF Margin 2031E", "", "WACC", "", "Terminal Growth", "", "Exit EBITDA Multiple", ""],
  ["", "", "", "", "", "", "", "", "", "", "", ""],
];
d.getRange("B5").formulas = [["=Assumptions!B5"]];
d.getRange("D5").formulas = [["=Assumptions!B7"]];
d.getRange("F5").formulas = [["=Checks!E12"]];
d.getRange("H5").formulas = [["='DCF Valuation'!B14"]];
d.getRange("J5").formulas = [["='DCF Valuation'!B19"]];
d.getRange("L5").formulas = [["='DCF Valuation'!B21"]];
d.getRange("B7").formulas = [["=('Forecast Model'!G6/'Forecast Model'!B6)^(1/5)-1"]];
d.getRange("D7").formulas = [["='Forecast Model'!G15"]];
d.getRange("F7").formulas = [["='Forecast Model'!G22/'Forecast Model'!G6"]];
d.getRange("H7").formulas = [["=Assumptions!B29"]];
d.getRange("J7").formulas = [["=Assumptions!G29"]];
d.getRange("L7").formulas = [["='DCF Valuation'!B22"]];
linkedFormulaStyle(d.getRange("B5:L7"));
d.getRange("A5:L8").format = { fill: palette.gray1, borders: { insideHorizontal: { style: "continuous", color: palette.gray2 }, insideVertical: { style: "continuous", color: palette.gray2 } }, wrapText: true };
d.getRange("A5:L5").format.font = { bold: true, color: palette.gray3 };
d.getRange("A7:L7").format.font = { bold: true, color: palette.gray3 };
d.getRange("B5:L5").format.font = { bold: true, color: palette.navy, size: 12 };
d.getRange("B7:L7").format.font = { bold: true, color: palette.navy, size: 12 };
d.getRange("H5:J5").setNumberFormat(fmt.money);
d.getRange("L5").setNumberFormat(fmt.perShare);
d.getRange("B7:J7").setNumberFormat(fmt.percent);
d.getRange("L7").setNumberFormat(fmt.multiple);
d.getRange("F5").conditionalFormats.add("containsText", { text: "OK", format: { fill: palette.paleTeal, font: { bold: true, color: palette.green } } });
d.getRange("F5").conditionalFormats.add("containsText", { text: "Check", format: { fill: palette.paleRed, font: { bold: true, color: palette.red } } });
section(d, "A11:F11", "Revenue, EBITDA, and FCF Trend");
d.getRange("A12:D18").values = [
  ["Year", "Revenue", "EBITDA", "Unlevered FCF"],
  ["2026A", "", "", ""],
  ["2027E", "", "", ""],
  ["2028E", "", "", ""],
  ["2029E", "", "", ""],
  ["2030E", "", "", ""],
  ["2031E", "", "", ""],
];
d.getRange("B13:D18").formulas = [
  ["='Forecast Model'!B6", "='Forecast Model'!B14", "='Forecast Model'!B22"],
  ["='Forecast Model'!C6", "='Forecast Model'!C14", "='Forecast Model'!C22"],
  ["='Forecast Model'!D6", "='Forecast Model'!D14", "='Forecast Model'!D22"],
  ["='Forecast Model'!E6", "='Forecast Model'!E14", "='Forecast Model'!E22"],
  ["='Forecast Model'!F6", "='Forecast Model'!F14", "='Forecast Model'!F22"],
  ["='Forecast Model'!G6", "='Forecast Model'!G14", "='Forecast Model'!G22"],
];
header(d.getRange("A12:D12"));
body(d.getRange("A13:D18"));
d.getRange("B13:D18").setNumberFormat(fmt.money);
const chart1 = d.charts.add("line", d.getRange("A12:D18"));
chart1.title = "Revenue, EBITDA, and FCF";
chart1.hasLegend = true;
chart1.xAxis = { axisType: "textAxis" };
chart1.yAxis = { numberFormatCode: "$#,##0" };
chart1.setPosition("F11", "L25");
section(d, "A21:F21", "Valuation Bridge");
d.getRange("A22:C28").values = [
  ["Bridge Item", "Value", "Notes"],
  ["Enterprise Value", "", "DCF enterprise value"],
  ["Cash & Equivalents", "", "Add"],
  ["Debt", "", "Subtract"],
  ["Minority Interest", "", "Subtract"],
  ["Investments / Other Assets", "", "Add"],
  ["Equity Value", "", "Bridge result"],
];
d.getRange("B23:B28").formulas = [
  ["='DCF Valuation'!B14"],
  ["='DCF Valuation'!B15"],
  ["=-'DCF Valuation'!B16"],
  ["=-'DCF Valuation'!B17"],
  ["='DCF Valuation'!B18"],
  ["='DCF Valuation'!B19"],
];
header(d.getRange("A22:C22"));
body(d.getRange("A23:C28"));
d.getRange("B23:B28").setNumberFormat(fmt.money);
const chart2 = d.charts.add("bar", d.getRange("A22:B28"));
chart2.title = "Equity Value Bridge";
chart2.hasLegend = false;
chart2.xAxis = { axisType: "textAxis" };
chart2.yAxis = { numberFormatCode: "$#,##0" };
chart2.setPosition("F27", "L40");
d.freezePanes.freezeRows(4);

// Tables where helpful.
h.tables.add("A5:H20", true, "HistoricalFinancials");
f.tables.add("A5:I22", true, "ForecastModel");
src.tables.add("A4:G11", true, "SourcesAudit");

// Comments for key source assumptions.
workbook.comments.setSelf({ displayName: "ChatGPT" });
workbook.comments.addThread({ cell: a.getRange("B5") }, "Input: replace ExampleCo Inc. with the target company's legal or reporting name.");
workbook.comments.addThread({ cell: a.getRange("B29") }, "Input: replace WACC with a company-specific estimate from market data or cost of capital analysis.");
workbook.comments.addThread({ cell: h.getRange("B6") }, "Placeholder: replace historical values with company reported financials and cite the filing in Sources & Audit.");
workbook.comments.addThread({ cell: src.getRange("F5") }, "Add the plain-text URL for the relevant filing or source.");

// Visual and formula verification artifacts.
const previews = [
  ["Dashboard", "A1:L40"],
  ["Assumptions", "A1:J36"],
  ["Historical Financials", "A1:H30"],
  ["Forecast Model", "A1:I22"],
  ["DCF Valuation", "A1:I23"],
  ["Sensitivity", "A1:J11"],
  ["Checks", "A1:F12"],
  ["Sources & Audit", "A1:G11"],
];

for (const [sheetName, range] of previews) {
  const preview = await workbook.render({ sheetName, range, scale: 1, format: "png" });
  await fs.writeFile(path.join(outputDir, `${sheetName.replaceAll(/[ &]/g, "_")}.png`), new Uint8Array(await preview.arrayBuffer()));
}

const dashInspect = await workbook.inspect({
  kind: "table",
  range: "Dashboard!A1:L18",
  include: "values,formulas",
  tableMaxRows: 18,
  tableMaxCols: 12,
  maxChars: 5000,
});
console.log("DASHBOARD_INSPECT");
console.log(dashInspect.ndjson);

const checkInspect = await workbook.inspect({
  kind: "table",
  range: "Checks!A4:F12",
  include: "values,formulas",
  tableMaxRows: 12,
  tableMaxCols: 6,
  maxChars: 5000,
});
console.log("CHECKS_INSPECT");
console.log(checkInspect.ndjson);

const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!",
  options: { useRegex: true, maxResults: 300 },
  summary: "final formula error scan",
  maxChars: 5000,
});
console.log("ERROR_SCAN");
console.log(errors.ndjson);

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(path.join(outputDir, "company_financial_analysis.xlsx"));
console.log(path.join(outputDir, "company_financial_analysis.xlsx"));
