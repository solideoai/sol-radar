"""시험용 문서 합성기(PDF·HWPX·HWP 5.0). 저장소에 실제 공고 첨부를 넣지 않으려고 바이트를 직접 만든다.

제품 파서를 쓰지 않는다. 형식 명세(PDF 1.4, OWPML, HWP 5.0 레코드·OLE 복합 문서 v3)대로 최소 구조만 쓴다.
"""

import io
import struct
import zipfile
import zlib

# ---------------------------------------------------------------- PDF


def pdf_bytes(
    texts: list[tuple[float, float, str]], rects: list[tuple[float, float, float, float]]
):
    """Helvetica 글자(x, y, 문자열)와 테두리 사각형(x, y, w, h)만 있는 한 쪽짜리 PDF."""
    ops = ["0.5 w"] + [f"{x} {y} {w} {h} re S" for x, y, w, h in rects]
    for x, y, text in texts:
        ops.append(f"BT /F1 10 Tf {x} {y} Td ({text}) Tj ET")
    content = "\n".join(ops).encode("latin-1")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        (
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R "
            b"/Resources << /Font << /F1 5 0 R >> >> >>"
        ),
        b"<< /Length %d >>\nstream\n" % len(content) + content + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % number + body + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    out += b"".join(b"%010d 00000 n \n" % offset for offset in offsets)
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (
        len(objects) + 1,
        xref,
    )
    return bytes(out)


# ---------------------------------------------------------------- HWPX

HWPX_NS = (
    'xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" '
    'xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph"'
)


def hwpx_paragraph(text: str) -> str:
    return f"<hp:p><hp:run><hp:t>{text}</hp:t></hp:run></hp:p>"


def hwpx_table(rows: list[list[str]]) -> str:
    """셀마다 cellAddr·cellSpan 을 단 표를 품은 문단."""
    trs = []
    for r, row in enumerate(rows):
        tcs = "".join(
            f"<hp:tc><hp:subList>{hwpx_paragraph(text)}</hp:subList>"
            f'<hp:cellAddr colAddr="{c}" rowAddr="{r}"/><hp:cellSpan colSpan="1" rowSpan="1"/></hp:tc>'
            for c, text in enumerate(row)
        )
        trs.append(f"<hp:tr>{tcs}</hp:tr>")
    table = f'<hp:tbl rowCnt="{len(rows)}" colCnt="{len(rows[0])}">{"".join(trs)}</hp:tbl>'
    return f"<hp:p><hp:run>{table}</hp:run></hp:p>"


def hwpx_section(body: str) -> bytes:
    return f'<?xml version="1.0" encoding="UTF-8"?><hs:sec {HWPX_NS}>{body}</hs:sec>'.encode()


def hwpx_bytes(*sections: bytes, extra: list[tuple[str, bytes]] = ()) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr(
            zipfile.ZipInfo("mimetype"), b"application/hwp+zip", compress_type=zipfile.ZIP_STORED
        )
        for index, section in enumerate(sections):
            archive.writestr(
                f"Contents/section{index}.xml", section, compress_type=zipfile.ZIP_DEFLATED
            )
        for name, data in extra:
            archive.writestr(name, data, compress_type=zipfile.ZIP_DEFLATED)
    return buffer.getvalue()


# ---------------------------------------------------------------- HWP 5.0 레코드

PARA_HEADER, PARA_TEXT, CTRL_HEADER, LIST_HEADER, TABLE = 66, 67, 71, 72, 77


def record(tag: int, level: int, payload: bytes) -> bytes:
    if len(payload) >= 0xFFF:
        return struct.pack("<II", tag | level << 10 | 0xFFF << 20, len(payload)) + payload
    return struct.pack("<I", tag | level << 10 | len(payload) << 20) + payload


def wchars(*units: int) -> bytes:
    return struct.pack(f"<{len(units)}H", *units)


def inline_control(code: int, ctrl_id: bytes = b"\0\0\0\0") -> bytes:
    """인라인·확장 제어: 코드 + 정보 12바이트(컨트롤 id 4바이트 포함) + 코드 = 8 WCHAR."""
    return wchars(code) + ctrl_id[::-1] + b"\0" * 8 + wchars(code)


def text_units(text: str) -> bytes:
    return text.encode("utf-16-le")


def paragraph(level: int, text: bytes, controls: bytes = b"") -> bytes:
    return (
        record(PARA_HEADER, level, b"\0" * 22)
        + record(PARA_TEXT, level + 1, text + wchars(13))
        + controls
    )


def table_control(level: int, rows: list[list[str]]) -> bytes:
    """CTRL_HEADER 'tbl ' + TABLE + 셀마다 LIST_HEADER(열·행 주소) + 문단."""
    out = record(CTRL_HEADER, level, b"tbl "[::-1] + b"\0" * 40)
    out += record(TABLE, level + 1, struct.pack("<IHH", 0, len(rows), len(rows[0])) + b"\0" * 14)
    for r, row in enumerate(rows):
        for c, text in enumerate(row):
            out += record(LIST_HEADER, level + 1, struct.pack("<hHI4H", 1, 0, 0, c, r, 1, 1))
            out += paragraph(level + 1, text_units(text))
    return out


def hwp_file_header(flags: int) -> bytes:
    signature = b"HWP Document File".ljust(32, b"\0")
    return signature + struct.pack("<II", 0x05010100, flags) + b"\0" * 216


# ---------------------------------------------------------------- OLE 복합 문서(v3, 512바이트 섹터)

SECTOR = 512
MIN_STREAM = 4096  # 이보다 짧은 스트림은 mini stream 에 들어가야 하므로 채워서 피한다
FREESECT, ENDOFCHAIN, FATSECT, NOSTREAM = 0xFFFFFFFF, 0xFFFFFFFE, 0xFFFFFFFD, 0xFFFFFFFF


def _dir_entry(name: str, kind: int, child: int, right: int, start: int, size: int) -> bytes:
    encoded = (name + "\0").encode("utf-16-le")
    return (
        encoded.ljust(64, b"\0")
        + struct.pack("<HBB3I", len(encoded), kind, 1, NOSTREAM, right, child)
        + b"\0" * 36
        + struct.pack("<IQ", start, size)
    )


def ole_bytes(file_header: bytes, section0: bytes) -> bytes:
    """Root/FileHeader, Root/BodyText/Section0 두 스트림만 있는 OLE 파일."""
    streams = [
        s.ljust(max(MIN_STREAM, -(-len(s) // SECTOR) * SECTOR), b"\0")
        for s in (file_header, section0)
    ]
    fat = [FATSECT, ENDOFCHAIN]  # 0: FAT, 1: 디렉터리
    starts = []
    for stream in streams:
        starts.append(len(fat))
        count = len(stream) // SECTOR
        fat += [len(fat) + i + 1 for i in range(count - 1)] + [ENDOFCHAIN]
    assert len(fat) <= SECTOR // 4
    fat_sector = struct.pack(f"<{SECTOR // 4}I", *fat, *[FREESECT] * (SECTOR // 4 - len(fat)))
    directory = (
        _dir_entry("Root Entry", 5, 1, NOSTREAM, ENDOFCHAIN, 0)
        + _dir_entry("FileHeader", 2, NOSTREAM, 2, starts[0], len(streams[0]))
        + _dir_entry("BodyText", 1, 3, NOSTREAM, 0, 0)
        + _dir_entry("Section0", 2, NOSTREAM, NOSTREAM, starts[1], len(streams[1]))
    )
    header = (
        bytes.fromhex("D0CF11E0A1B11AE1")
        + b"\0" * 16
        + struct.pack("<HHHHH", 0x3E, 3, 0xFFFE, 9, 6)
        + b"\0" * 6
        + struct.pack("<IIIIIIIII", 0, 1, 1, 0, MIN_STREAM, ENDOFCHAIN, 0, ENDOFCHAIN, 0)
        + struct.pack("<109I", 0, *[FREESECT] * 108)
    )
    return header + fat_sector + directory + b"".join(streams)


def hwp_bytes(body: bytes, flags: int = 0x1) -> bytes:
    """본문 레코드를 raw deflate 로 압축(속성 비트 0)해 HWP 5.0 파일로 만든다."""
    compressor = zlib.compressobj(wbits=-zlib.MAX_WBITS)
    section = compressor.compress(body) + compressor.flush() if flags & 0x1 else body
    return ole_bytes(hwp_file_header(flags), section)
