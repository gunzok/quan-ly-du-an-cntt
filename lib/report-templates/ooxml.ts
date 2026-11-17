import { crc32, inflateRawSync } from "node:zlib";
import {
  REPORT_TEMPLATE_MAX_ENTRIES,
  REPORT_TEMPLATE_MAX_UNCOMPRESSED_BYTES,
  type ReportTemplateKind,
} from "./model";

/**
 * Kiểm nội dung nhị phân của tệp template ở MÁY CHỦ (security.md F4), không tin đuôi hay MIME do
 * trình duyệt khai:
 *   1. Chữ ký ZIP: bắt đầu bằng "PK\x03\x04", có bản ghi cuối thư mục (EOCD) hợp lệ, không ZIP64,
 *      không nhiều đĩa, không mã hóa, chỉ phương thức stored/deflate.
 *   2. Chặn ZIP bomb: tối đa REPORT_TEMPLATE_MAX_ENTRIES mục; GIẢI NÉN THẬT từng mục với trần
 *      maxOutputLength (tổng tối đa REPORT_TEMPLATE_MAX_UNCOMPRESSED_BYTES), đối chiếu kích thước và
 *      CRC với số khai trong ZIP (khai man thì từ chối). Không ghi gì ra đĩa.
 *   3. Tên mục an toàn (không "..", không đường dẫn tuyệt đối, không "\", không ký tự điều khiển),
 *      không trùng.
 *   4. Cấu trúc OOXML: có [Content_Types].xml; docx có word/document.xml, xlsx có xl/workbook.xml;
 *      content type của phần chính đúng loại (docx/xlsx thường, không phải template .dotx/.xltx hay
 *      bản có macro).
 *   5. Từ chối macro: mục vbaProject.bin / vbaData.xml / activeX ở bất kỳ đâu, hoặc content type
 *      chứa macroEnabled / vbaProject.
 */

export type OoxmlRejection =
  /** Không phải ZIP/OOXML hợp lệ, hỏng, hoặc nội dung khác loại với đuôi tệp. */
  | "signature"
  /** Có macro hoặc ActiveX. */
  | "macro"
  /** Quá nhiều mục hoặc giải nén quá lớn (ZIP bomb). */
  | "zip_bomb";

export type OoxmlInspection =
  { ok: true } | { ok: false; reason: OoxmlRejection };

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;

const MAIN_PART: Record<ReportTemplateKind, { part: string; type: string }> = {
  docx: {
    part: "word/document.xml",
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
  },
  xlsx: {
    part: "xl/workbook.xml",
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
  },
};

const CONTENT_TYPES = "[Content_Types].xml";
const CONTENT_TYPES_MAX = 1024 * 1024;

interface Entry {
  name: string;
  rawName: Buffer;
  method: number;
  crc: number;
  compressedSize: number;
  size: number;
  localOffset: number;
}

class Reject extends Error {
  constructor(readonly reason: OoxmlRejection) {
    super(reason);
  }
}

function findEocd(buf: Buffer): number {
  // EOCD 22 byte + chú thích tối đa 65535 byte, tìm từ cuối về.
  const min = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) return i;
  }
  return -1;
}

function isSafeEntryName(name: string): boolean {
  if (name.length === 0 || name.length > 512) return false;
  if (name.startsWith("/") || name.includes("\\") || name.includes(":")) {
    return false;
  }

  if (/[\u0000-\u001f\u007f]/.test(name)) return false;
  return !name.split("/").some((seg) => seg === ".." || seg === ".");
}

function readEntries(buf: Buffer): Entry[] {
  if (buf.length < 22 + 30 || buf.readUInt32LE(0) !== SIG_LOCAL) {
    throw new Reject("signature");
  }
  const eocd = findEocd(buf);
  if (eocd < 0) throw new Reject("signature");
  const diskNumber = buf.readUInt16LE(eocd + 4);
  const cdDisk = buf.readUInt16LE(eocd + 6);
  const entriesOnDisk = buf.readUInt16LE(eocd + 8);
  const total = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const commentLength = buf.readUInt16LE(eocd + 20);
  if (diskNumber !== 0 || cdDisk !== 0 || entriesOnDisk !== total) {
    throw new Reject("signature");
  }
  // ZIP64 (giá trị 0xFFFF/0xFFFFFFFF) không cần cho tệp vài MB: từ chối.
  if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw new Reject("signature");
  }
  if (eocd + 22 + commentLength !== buf.length) throw new Reject("signature");
  if (cdOffset + cdSize > eocd) throw new Reject("signature");
  if (total > REPORT_TEMPLATE_MAX_ENTRIES) throw new Reject("zip_bomb");
  if (total === 0) throw new Reject("signature");

  const entries: Entry[] = [];
  const seen = new Set<string>();
  let p = cdOffset;
  for (let i = 0; i < total; i++) {
    if (p + 46 > eocd || buf.readUInt32LE(p) !== SIG_CENTRAL) {
      throw new Reject("signature");
    }
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const compressedSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLength = buf.readUInt16LE(p + 28);
    const extraLength = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const nameEnd = p + 46 + nameLength;
    if (nameEnd > eocd) throw new Reject("signature");
    const nameBytes = buf.subarray(p + 46, nameEnd);
    const name =
      flags & 0x0800
        ? nameBytes.toString("utf8")
        : nameBytes.toString("latin1");
    p = nameEnd + extraLength + commentLen;
    if (p > cdOffset + cdSize) throw new Reject("signature");

    // Bit 0: mã hóa; bit 6: mã hóa mạnh. Không xử lý được thì không nhận.
    if (flags & 0x0001 || flags & 0x0040) throw new Reject("signature");
    if (method !== 0 && method !== 8) throw new Reject("signature");
    if (!isSafeEntryName(name)) throw new Reject("signature");
    const key = name.toLowerCase();
    if (seen.has(key)) throw new Reject("signature");
    seen.add(key);
    entries.push({
      name,
      rawName: nameBytes,
      method,
      crc,
      compressedSize,
      size,
      localOffset,
    });
  }
  return entries;
}

/** Giải nén một mục với trần kích thước; sai kích thước hoặc CRC: hỏng. */
function extract(buf: Buffer, entry: Entry, budget: number): Buffer {
  const at = entry.localOffset;
  if (at + 30 > buf.length || buf.readUInt32LE(at) !== SIG_LOCAL) {
    throw new Reject("signature");
  }
  const localNameLength = buf.readUInt16LE(at + 26);
  // Tên trong header cục bộ phải trùng thư mục trung tâm (chống ZIP "hai mặt").
  const localName = buf.subarray(at + 30, at + 30 + localNameLength);
  if (!localName.equals(entry.rawName)) throw new Reject("signature");
  const start = at + 30 + localNameLength + buf.readUInt16LE(at + 28);
  const end = start + entry.compressedSize;
  if (end > buf.length) throw new Reject("signature");
  if (entry.size > budget) throw new Reject("zip_bomb");
  const data = buf.subarray(start, end);
  let out: Buffer;
  if (entry.method === 0) {
    out = data;
  } else {
    try {
      // +1 để phát hiện mục giải nén ra NHIỀU hơn số đã khai.
      out = inflateRawSync(data, { maxOutputLength: entry.size + 1 });
    } catch (error) {
      if ((error as { code?: string }).code === "ERR_BUFFER_TOO_LARGE") {
        throw new Reject("zip_bomb");
      }
      throw new Reject("signature");
    }
  }
  if (out.length !== entry.size || crc32(out) !== entry.crc) {
    throw new Reject(out.length > entry.size ? "zip_bomb" : "signature");
  }
  return out;
}

export function inspectOoxml(
  buf: Buffer,
  kind: ReportTemplateKind,
): OoxmlInspection {
  try {
    const entries = readEntries(buf);
    const names = new Set(entries.map((e) => e.name));

    // Macro/ActiveX: chỉ nhìn tên là đủ để từ chối, không cần giải nén.
    if (
      entries.some((e) => {
        const n = e.name.toLowerCase();
        return (
          n.endsWith("vbaproject.bin") ||
          n.endsWith("vbadata.xml") ||
          n.includes("/activex/") ||
          n.startsWith("activex/")
        );
      })
    ) {
      return { ok: false, reason: "macro" };
    }

    const main = MAIN_PART[kind];
    if (!names.has(CONTENT_TYPES) || !names.has(main.part)) {
      return { ok: false, reason: "signature" };
    }

    let budget = REPORT_TEMPLATE_MAX_UNCOMPRESSED_BYTES;
    let contentTypes = "";
    for (const entry of entries) {
      // Thư mục (tên kết thúc "/") phải rỗng.
      if (entry.name.endsWith("/")) {
        if (entry.size !== 0) return { ok: false, reason: "signature" };
        continue;
      }
      if (entry.name === CONTENT_TYPES && entry.size > CONTENT_TYPES_MAX) {
        return { ok: false, reason: "signature" };
      }
      const out = extract(buf, entry, budget);
      budget -= out.length;
      if (entry.name === CONTENT_TYPES) contentTypes = out.toString("utf8");
    }

    if (/macroEnabled|vbaProject/i.test(contentTypes)) {
      return { ok: false, reason: "macro" };
    }
    // Phần chính phải khai đúng content type của loại tệp (docx thường / xlsx thường).
    const override = new RegExp(
      `<Override\\b[^>]*PartName="/${main.part.replace(/[.]/g, "\\.")}"[^>]*>`,
      "i",
    ).exec(contentTypes);
    if (!override || !override[0].includes(`ContentType="${main.type}"`)) {
      return { ok: false, reason: "signature" };
    }
    return { ok: true };
  } catch (error) {
    if (error instanceof Reject) return { ok: false, reason: error.reason };
    return { ok: false, reason: "signature" };
  }
}
