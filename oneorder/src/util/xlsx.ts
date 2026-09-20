import { strToU8, zipSync } from 'fflate';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}

function colName(i: number): string {
  let n = i + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export type Cell = string | number;

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const NS_DOC_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

export function buildXlsx(sheetName: string, headers: string[], rows: Cell[][]): Uint8Array {
  const all: Cell[][] = [headers, ...rows];
  const sheetRows = all
    .map((row, r) => {
      const cells = row
        .map((v, c) => {
          const ref = `${colName(c)}${r + 1}`;
          if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"><v>${v}</v></c>`;
          const style = r === 0 ? ' s="1"' : '';
          return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`;
        })
        .join('');
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join('');
  const lastCol = colName(Math.max(0, headers.length - 1));
  const cols = headers
    .map((_, i) => `<col min="${i + 1}" max="${i + 1}" width="${i === 1 ? 28 : 18}" customWidth="1"/>`)
    .join('');
  const sheet =
    `${XML}<worksheet xmlns="${NS_MAIN}">` +
    `<dimension ref="A1:${lastCol}${all.length}"/>` +
    `<cols>${cols}</cols><sheetData>${sheetRows}</sheetData></worksheet>`;
  const name = esc(sheetName.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet1');
  return zipSync({
    '[Content_Types].xml': strToU8(
      `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
        `</Types>`,
    ),
    '_rels/.rels': strToU8(
      `${XML}<Relationships xmlns="${NS_REL}">` +
        `<Relationship Id="rId1" Type="${NS_DOC_REL}/officeDocument" Target="xl/workbook.xml"/>` +
        `</Relationships>`,
    ),
    'xl/workbook.xml': strToU8(
      `${XML}<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_DOC_REL}">` +
        `<sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `${XML}<Relationships xmlns="${NS_REL}">` +
        `<Relationship Id="rId1" Type="${NS_DOC_REL}/worksheet" Target="worksheets/sheet1.xml"/>` +
        `<Relationship Id="rId2" Type="${NS_DOC_REL}/styles" Target="styles.xml"/>` +
        `</Relationships>`,
    ),
    'xl/styles.xml': strToU8(
      `${XML}<styleSheet xmlns="${NS_MAIN}">` +
        `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
        `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
        `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
        `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
        `<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
        `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>` +
        `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
        `</styleSheet>`,
    ),
    'xl/worksheets/sheet1.xml': strToU8(sheet),
  });
}
