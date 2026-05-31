import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const outputDir = "C:/Users/paha1/arbor/outputs/brigade_analytics_google";
await fs.mkdir(outputDir, { recursive: true });

const workbook = Workbook.create();
const dashboard = workbook.worksheets.add("Dashboard");
const settings = workbook.worksheets.add("Ustawienia");
const raw = workbook.worksheets.add("Dane scalone");
const kpi = workbook.worksheets.add("KPI brygad");
const weekly = workbook.worksheets.add("Tygodnie");
const alerts = workbook.worksheets.add("Alerty");

const colors = {
  navy: "#17324D",
  teal: "#0F766E",
  green: "#16803C",
  red: "#B42318",
  amber: "#B7791F",
  blueSoft: "#EAF2FF",
  tealSoft: "#E7F5F1",
  amberSoft: "#FFF7D6",
  redSoft: "#FDECEC",
  gray: "#E6EAF0",
  graySoft: "#F7F9FC",
  text: "#111827",
  muted: "#64748B",
  white: "#FFFFFF",
};

function base(sheet) {
  sheet.showGridLines = false;
  sheet.getRange("A:Z").format = { font: { name: "Aptos", size: 10, color: colors.text } };
}

function width(sheet, widths) {
  widths.forEach((w, i) => (sheet.getCell(0, i).format.columnWidthPx = w));
}

function title(sheet, range, value, subtitle) {
  sheet.getRange(range).merge();
  sheet.getRange(range.split(":")[0]).values = [[value]];
  sheet.getRange(range).format = {
    fill: colors.navy,
    font: { bold: true, color: colors.white, size: 16 },
    verticalAlignment: "center",
  };
  if (subtitle) {
    const row = Number(range.match(/\d+/)[0]) + 1;
    sheet.getRange(`A${row}:J${row}`).merge();
    sheet.getRange(`A${row}`).values = [[subtitle]];
    sheet.getRange(`A${row}:J${row}`).format = {
      fill: colors.graySoft,
      font: { italic: true, color: colors.muted },
    };
  }
}

function section(sheet, range, value) {
  sheet.getRange(range).merge();
  sheet.getRange(range.split(":")[0]).values = [[value]];
  sheet.getRange(range).format = {
    fill: colors.teal,
    font: { bold: true, color: colors.white },
  };
}

function header(range) {
  range.format = {
    fill: colors.navy,
    font: { bold: true, color: colors.white },
    horizontalAlignment: "center",
    wrapText: true,
  };
}

function body(range) {
  range.format = {
    fill: colors.white,
    borders: {
      insideHorizontal: { style: "continuous", color: colors.gray },
      insideVertical: { style: "continuous", color: colors.gray },
    },
  };
}

for (const sheet of [dashboard, settings, raw, kpi, weekly, alerts]) base(sheet);

// Settings / automation setup
width(settings, [220, 420, 160, 220, 220, 220]);
title(settings, "A1:F1", "Ustawienia automatycznego pobierania", "Wpisz kilka linkow/ID arkuszy z analityki. Raport scala je do jednej tabeli.");
section(settings, "A4:F4", "Lista zrodel Google Sheets");
settings.getRange("A5:F17").values = [
  ["Aktywne", "Nazwa zrodla", "Spreadsheet URL/ID", "Zakres", "Naglowek?", "Opis"],
  [true, "Tabela 1", "", "Dane!A:K", true, "Pierwsza tabela z naglowkami"],
  [false, "Tabela 2", "", "Dane!A:K", true, "Kolejna tabela z naglowkami"],
  [false, "Tabela 3", "", "Dane!A:K", true, "Kolejna tabela z naglowkami"],
  [false, "Tabela 4", "", "Dane!A:K", true, "Kolejna tabela z naglowkami"],
  [false, "Tabela 5", "", "Dane!A:K", true, "Kolejna tabela z naglowkami"],
  [false, "Tabela 6", "", "Dane!A:K", true, "Kolejna tabela z naglowkami"],
  [false, "Tabela 7", "", "Dane!A:K", true, "Kolejna tabela z naglowkami"],
  [false, "Tabela 8", "", "Dane!A:K", true, "Kolejna tabela z naglowkami"],
  [false, "Tabela 9", "", "Dane!A:K", true, "Kolejna tabela z naglowkami"],
  [false, "Tabela 10", "", "Dane!A:K", true, "Kolejna tabela z naglowkami"],
  ["", "", "", "", "", ""],
  ["Progi", "Prog opoznienia", 0.1, "Prog wykorzystania", 0.85, ""],
];
header(settings.getRange("A5:C5"));
header(settings.getRange("A5:F5"));
body(settings.getRange("A6:F17"));
settings.getRange("A6:E15").format = { fill: colors.amberSoft, font: { color: "#0000FF" }, wrapText: true };
settings.getRange("C17").setNumberFormat("0.0%");
settings.getRange("E17").setNumberFormat("0.0%");
section(settings, "A20:F20", "Formula scalania do Google Sheets");
settings.getRange("A21:F26").values = [
  ["Komorka docelowa", "Formula", "Jak uzyc", "", "", ""],
  ["Dane scalone!A1", '\'=LET(src,FILTER({Ustawienia!C6:C15,Ustawienia!D6:D15},Ustawienia!A6:A15=TRUE,Ustawienia!C6:C15<>""),VSTACK(INDEX(IMPORTRANGE(INDEX(src,1,1),INDEX(src,1,2)),1,),DROP(REDUCE("",SEQUENCE(ROWS(src)),LAMBDA(acc,i,VSTACK(acc,DROP(IMPORTRANGE(INDEX(src,i,1),INDEX(src,i,2)),1)))),1)))', "Po imporcie do Google Sheets wstaw te formule w A1 zakladki Dane scalone.", "", "", ""],
  ["", "", "Pierwsze uzycie kazdego IMPORTRANGE wymaga klikniecia Allow access w Google Sheets.", "", "", ""],
  ["", "", "Wszystkie tabele musza miec te same kolumny w tej samej kolejnosci.", "", "", ""],
  ["", "", "Wymagane kolumny: Data, Brygada, Kierownik, Region, Zadania, Zakonczone, Opoznione, Roboczogodziny, Koszt, Przychod, Uwagi.", "", "", ""],
  ["", "", "", "", "", ""],
];
header(settings.getRange("A21:C21"));
body(settings.getRange("A22:C26"));
settings.freezePanes.freezeRows(4);

// Raw data
width(raw, [110, 130, 140, 110, 90, 110, 100, 130, 110, 120, 260]);
title(raw, "A1:K1", "Dane scalone", "Tu ma trafic jedna wspolna tabela ze wszystkich zrodel. Przykladowe dane sa tylko do testu dashboardu.");
raw.getRange("A4:K4").values = [["Data", "Brygada", "Kierownik", "Region", "Zadania", "Zakonczone", "Opoznione", "Roboczogodziny", "Koszt", "Przychod", "Uwagi"]];
const rows = [
  [new Date(2026, 4, 1), "Brygada A", "Kowalski", "Polnoc", 42, 39, 3, 310, 18500, 27600, ""],
  [new Date(2026, 4, 1), "Brygada B", "Nowak", "Poludnie", 35, 33, 2, 265, 15900, 22900, ""],
  [new Date(2026, 4, 1), "Brygada C", "Zielinski", "Centrum", 51, 47, 4, 355, 22100, 33800, ""],
  [new Date(2026, 4, 8), "Brygada A", "Kowalski", "Polnoc", 45, 43, 2, 322, 19320, 29100, ""],
  [new Date(2026, 4, 8), "Brygada B", "Nowak", "Poludnie", 38, 34, 4, 290, 17400, 24100, "wiecej opoznien"],
  [new Date(2026, 4, 8), "Brygada C", "Zielinski", "Centrum", 55, 53, 2, 365, 22630, 35600, ""],
  [new Date(2026, 4, 15), "Brygada A", "Kowalski", "Polnoc", 47, 46, 1, 330, 19800, 30400, ""],
  [new Date(2026, 4, 15), "Brygada B", "Nowak", "Poludnie", 40, 36, 4, 305, 18300, 25500, ""],
  [new Date(2026, 4, 15), "Brygada C", "Zielinski", "Centrum", 56, 54, 2, 370, 22940, 36200, ""],
  [new Date(2026, 4, 22), "Brygada A", "Kowalski", "Polnoc", 49, 48, 1, 336, 20160, 31500, ""],
  [new Date(2026, 4, 22), "Brygada B", "Nowak", "Poludnie", 41, 39, 2, 310, 18600, 26700, ""],
  [new Date(2026, 4, 22), "Brygada C", "Zielinski", "Centrum", 58, 57, 1, 378, 23440, 37900, ""],
];
raw.getRange("A5:K16").values = rows;
header(raw.getRange("A4:K4"));
body(raw.getRange("A5:K104"));
raw.getRange("A5:A104").setNumberFormat("yyyy-mm-dd");
raw.getRange("E5:J104").setNumberFormat("#,##0");
raw.tables.add("A4:K104", true, "DaneBrygadScalone");
raw.freezePanes.freezeRows(4);

// KPI
width(kpi, [160, 110, 110, 110, 120, 120, 120, 120, 120, 120]);
title(kpi, "A1:J1", "KPI brygad", "Podsumowanie brygad na podstawie danych surowych.");
kpi.getRange("A4:J4").values = [["Brygada", "Zadania", "Zakonczone", "Opoznione", "Completion %", "Delay %", "Roboczogodziny", "Zadania / h", "Koszt / zadanie", "Marza"]];
const brigadeNames = ["Brygada A", "Brygada B", "Brygada C"];
kpi.getRange("A5:A7").values = brigadeNames.map((x) => [x]);
kpi.getRange("B5:J7").formulas = brigadeNames.map((_, i) => {
  const r = i + 5;
  return [
    `=SUMIF('Dane scalone'!$B$5:$B$104,A${r},'Dane scalone'!$E$5:$E$104)`,
    `=SUMIF('Dane scalone'!$B$5:$B$104,A${r},'Dane scalone'!$F$5:$F$104)`,
    `=SUMIF('Dane scalone'!$B$5:$B$104,A${r},'Dane scalone'!$G$5:$G$104)`,
    `=IFERROR(C${r}/B${r},0)`,
    `=IFERROR(D${r}/B${r},0)`,
    `=SUMIF('Dane scalone'!$B$5:$B$104,A${r},'Dane scalone'!$H$5:$H$104)`,
    `=IFERROR(C${r}/G${r},0)`,
    `=IFERROR(SUMIF('Dane scalone'!$B$5:$B$104,A${r},'Dane scalone'!$I$5:$I$104)/B${r},0)`,
    `=SUMIF('Dane scalone'!$B$5:$B$104,A${r},'Dane scalone'!$J$5:$J$104)-SUMIF('Dane scalone'!$B$5:$B$104,A${r},'Dane scalone'!$I$5:$I$104)`,
  ];
});
header(kpi.getRange("A4:J4"));
body(kpi.getRange("A5:J7"));
kpi.getRange("B5:D7").setNumberFormat("#,##0");
kpi.getRange("E5:F7").setNumberFormat("0.0%");
kpi.getRange("G5:G7").setNumberFormat("#,##0");
kpi.getRange("H5:H7").setNumberFormat("0.00");
kpi.getRange("I5:J7").setNumberFormat("$#,##0;[Red]($#,##0);-");
kpi.getRange("F5:F7").conditionalFormats.add("cellIs", { operator: "greaterThan", formula: "=Ustawienia!$C$17", format: { fill: colors.redSoft, font: { color: colors.red, bold: true } } });
kpi.freezePanes.freezeRows(4);

// Weekly summary
width(weekly, [130, 110, 110, 110, 120, 120, 120]);
title(weekly, "A1:G1", "Tygodnie", "Trend tygodniowy zadan, opoznien i marzy.");
weekly.getRange("A4:G9").values = [
  ["Tydzien", "Zadania", "Zakonczone", "Opoznione", "Delay %", "Roboczogodziny", "Marza"],
  [new Date(2026, 4, 1), "", "", "", "", "", ""],
  [new Date(2026, 4, 8), "", "", "", "", "", ""],
  [new Date(2026, 4, 15), "", "", "", "", "", ""],
  [new Date(2026, 4, 22), "", "", "", "", "", ""],
  [new Date(2026, 4, 29), "", "", "", "", "", ""],
];
weekly.getRange("B5:G9").formulas = [5, 6, 7, 8, 9].map((r) => [
  `=SUMIF('Dane scalone'!$A$5:$A$104,A${r},'Dane scalone'!$E$5:$E$104)`,
  `=SUMIF('Dane scalone'!$A$5:$A$104,A${r},'Dane scalone'!$F$5:$F$104)`,
  `=SUMIF('Dane scalone'!$A$5:$A$104,A${r},'Dane scalone'!$G$5:$G$104)`,
  `=IFERROR(D${r}/B${r},0)`,
  `=SUMIF('Dane scalone'!$A$5:$A$104,A${r},'Dane scalone'!$H$5:$H$104)`,
  `=SUMIF('Dane scalone'!$A$5:$A$104,A${r},'Dane scalone'!$J$5:$J$104)-SUMIF('Dane scalone'!$A$5:$A$104,A${r},'Dane scalone'!$I$5:$I$104)`,
]);
header(weekly.getRange("A4:G4"));
body(weekly.getRange("A5:G9"));
weekly.getRange("A5:A9").setNumberFormat("yyyy-mm-dd");
weekly.getRange("B5:D9").setNumberFormat("#,##0");
weekly.getRange("E5:E9").setNumberFormat("0.0%");
weekly.getRange("F5:F9").setNumberFormat("#,##0");
weekly.getRange("G5:G9").setNumberFormat("$#,##0;[Red]($#,##0);-");

// Alerts
width(alerts, [170, 150, 130, 160, 330]);
title(alerts, "A1:E1", "Alerty", "Lista obszarow wymagajacych uwagi.");
alerts.getRange("A4:E8").values = [
  ["Typ alertu", "Brygada", "Wartosc", "Status", "Komentarz"],
  ["Opoznienia", "Brygada A", "", "", "Delay % powyzej progu z Ustawienia"],
  ["Opoznienia", "Brygada B", "", "", "Delay % powyzej progu z Ustawienia"],
  ["Opoznienia", "Brygada C", "", "", "Delay % powyzej progu z Ustawienia"],
  ["Model", "Wszystkie", "", "", "Sprawdz czy dane surowe sa aktualne"],
];
alerts.getRange("C5:D8").formulas = [
  ["='KPI brygad'!F5", "=IF(C5>Ustawienia!$C$17,\"Sprawdz\",\"OK\")"],
  ["='KPI brygad'!F6", "=IF(C6>Ustawienia!$C$17,\"Sprawdz\",\"OK\")"],
  ["='KPI brygad'!F7", "=IF(C7>Ustawienia!$C$17,\"Sprawdz\",\"OK\")"],
  ["=COUNTA('Dane scalone'!A5:A104)", "=IF(C8>0,\"OK\",\"Brak danych\")"],
];
header(alerts.getRange("A4:E4"));
body(alerts.getRange("A5:E8"));
alerts.getRange("C5:C7").setNumberFormat("0.0%");
alerts.getRange("D5:D8").conditionalFormats.add("containsText", { text: "OK", format: { fill: colors.tealSoft, font: { bold: true, color: colors.green } } });
alerts.getRange("D5:D8").conditionalFormats.add("containsText", { text: "Sprawdz", format: { fill: colors.redSoft, font: { bold: true, color: colors.red } } });

// Dashboard
width(dashboard, [170, 130, 140, 130, 130, 130, 130, 130, 130, 130]);
title(dashboard, "A1:J1", "Dashboard brygad", "Raport gotowy do podpiecia pod Google Sheets z analityki.");
section(dashboard, "A4:J4", "Najwazniejsze KPI");
dashboard.getRange("A5:J7").values = [
  ["Zadania", "", "Zakonczone", "", "Completion %", "", "Delay %", "", "Marza", ""],
  ["", "", "", "", "", "", "", "", "", ""],
  ["Najlepsza brygada", "", "Najwiecej opoznien", "", "Roboczogodziny", "", "Koszt / zadanie", "", "Status", ""],
];
dashboard.getRange("B5").formulas = [["=SUM('KPI brygad'!B5:B7)"]];
dashboard.getRange("D5").formulas = [["=SUM('KPI brygad'!C5:C7)"]];
dashboard.getRange("F5").formulas = [["=IFERROR(D5/B5,0)"]];
dashboard.getRange("H5").formulas = [["=IFERROR(SUM('KPI brygad'!D5:D7)/B5,0)"]];
dashboard.getRange("J5").formulas = [["=SUM('KPI brygad'!J5:J7)"]];
dashboard.getRange("B7").formulas = [["=INDEX('KPI brygad'!A5:A7,MATCH(MAX('KPI brygad'!H5:H7),'KPI brygad'!H5:H7,0))"]];
dashboard.getRange("D7").formulas = [["=INDEX('KPI brygad'!A5:A7,MATCH(MAX('KPI brygad'!F5:F7),'KPI brygad'!F5:F7,0))"]];
dashboard.getRange("F7").formulas = [["=SUM('KPI brygad'!G5:G7)"]];
dashboard.getRange("H7").formulas = [["=IFERROR(SUM('Dane scalone'!I5:I104)/SUM('Dane scalone'!E5:E104),0)"]];
dashboard.getRange("J7").formulas = [["=IF(COUNTIF(Alerty!D5:D8,\"Sprawdz\")>0,\"Sprawdz\",\"OK\")"]];
body(dashboard.getRange("A5:J7"));
dashboard.getRange("A5:J5").format.font = { bold: true, color: colors.muted };
dashboard.getRange("A7:J7").format.font = { bold: true, color: colors.muted };
dashboard.getRange("B5:J7").format.font = { bold: true, color: colors.navy, size: 12 };
dashboard.getRange("B5:D5").setNumberFormat("#,##0");
dashboard.getRange("F5:H5").setNumberFormat("0.0%");
dashboard.getRange("J5").setNumberFormat("$#,##0;[Red]($#,##0);-");
dashboard.getRange("F7").setNumberFormat("#,##0");
dashboard.getRange("H7").setNumberFormat("$#,##0;[Red]($#,##0);-");
dashboard.getRange("J7").conditionalFormats.add("containsText", { text: "OK", format: { fill: colors.tealSoft, font: { bold: true, color: colors.green } } });
dashboard.getRange("J7").conditionalFormats.add("containsText", { text: "Sprawdz", format: { fill: colors.redSoft, font: { bold: true, color: colors.red } } });

section(dashboard, "A10:E10", "Ranking brygad");
dashboard.getRange("A11:E14").values = [["Brygada", "Zadania / h", "Completion %", "Delay %", "Marza"], ["", "", "", "", ""], ["", "", "", "", ""], ["", "", "", "", ""]];
dashboard.getRange("A12:E14").formulas = [
  ["='KPI brygad'!A5", "='KPI brygad'!H5", "='KPI brygad'!E5", "='KPI brygad'!F5", "='KPI brygad'!J5"],
  ["='KPI brygad'!A6", "='KPI brygad'!H6", "='KPI brygad'!E6", "='KPI brygad'!F6", "='KPI brygad'!J6"],
  ["='KPI brygad'!A7", "='KPI brygad'!H7", "='KPI brygad'!E7", "='KPI brygad'!F7", "='KPI brygad'!J7"],
];
header(dashboard.getRange("A11:E11"));
body(dashboard.getRange("A12:E14"));
dashboard.getRange("B12:B14").setNumberFormat("0.00");
dashboard.getRange("C12:D14").setNumberFormat("0.0%");
dashboard.getRange("E12:E14").setNumberFormat("$#,##0;[Red]($#,##0);-");

const chart1 = dashboard.charts.add("bar", dashboard.getRange("A11:E14"));
chart1.title = "Ranking brygad";
chart1.hasLegend = true;
chart1.xAxis = { axisType: "textAxis" };
chart1.setPosition("G10", "J23");

section(dashboard, "A18:E18", "Trend tygodniowy");
dashboard.getRange("A19:D24").formulas = [
  ["='Tygodnie'!A4", "='Tygodnie'!B4", "='Tygodnie'!D4", "='Tygodnie'!G4"],
  ["='Tygodnie'!A5", "='Tygodnie'!B5", "='Tygodnie'!D5", "='Tygodnie'!G5"],
  ["='Tygodnie'!A6", "='Tygodnie'!B6", "='Tygodnie'!D6", "='Tygodnie'!G6"],
  ["='Tygodnie'!A7", "='Tygodnie'!B7", "='Tygodnie'!D7", "='Tygodnie'!G7"],
  ["='Tygodnie'!A8", "='Tygodnie'!B8", "='Tygodnie'!D8", "='Tygodnie'!G8"],
  ["='Tygodnie'!A9", "='Tygodnie'!B9", "='Tygodnie'!D9", "='Tygodnie'!G9"],
];
header(dashboard.getRange("A19:D19"));
body(dashboard.getRange("A20:D24"));
dashboard.getRange("A20:A24").setNumberFormat("yyyy-mm-dd");
dashboard.getRange("B20:C24").setNumberFormat("#,##0");
dashboard.getRange("D20:D24").setNumberFormat("$#,##0;[Red]($#,##0);-");
const chart2 = dashboard.charts.add("line", dashboard.getRange("A19:D24"));
chart2.title = "Trend tygodniowy";
chart2.hasLegend = true;
chart2.xAxis = { axisType: "textAxis" };
chart2.setPosition("G25", "J38");
dashboard.freezePanes.freezeRows(4);

for (const [sheetName, range] of [
  ["Dashboard", "A1:J38"],
  ["Ustawienia", "A1:F20"],
  ["Dane scalone", "A1:K20"],
  ["KPI brygad", "A1:J8"],
  ["Tygodnie", "A1:G10"],
  ["Alerty", "A1:E8"],
]) {
  const preview = await workbook.render({ sheetName, range, scale: 1, format: "png" });
  await fs.writeFile(path.join(outputDir, `${sheetName.replaceAll(/[ ]/g, "_")}.png`), new Uint8Array(await preview.arrayBuffer()));
}

const dashboardInspect = await workbook.inspect({
  kind: "table",
  range: "Dashboard!A1:J24",
  include: "values,formulas",
  tableMaxRows: 24,
  tableMaxCols: 10,
  maxChars: 5000,
});
console.log(dashboardInspect.ndjson);

const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!",
  options: { useRegex: true, maxResults: 100 },
  summary: "formula errors",
  maxChars: 5000,
});
console.log(errors.ndjson);

const xlsx = await SpreadsheetFile.exportXlsx(workbook);
const output = path.join(outputDir, "raport_brygad_wiele_tabel_google_sheets.xlsx");
await xlsx.save(output);
console.log(output);
