"""Resume file validation: extension allow-list + magic bytes + structural checks.

The extension and the browser's Content-Type are attacker-controlled; only the bytes decide.
This blocks renamed executables/HTML/scripts, macro-enabled Office files, zip bombs and PDFs with
active content. It is not an antivirus: in production also scan with ClamAV (or S3 malware scanning).
"""

from __future__ import annotations

import io
import re
import unicodedata
import zipfile
from dataclasses import dataclass

from app.models import FileType

MAX_RESUME_BYTES = 5 * 1024 * 1024  # 5 MB
MAX_RESUMES_PER_USER = 5

CONTENT_TYPES = {
    FileType.PDF: "application/pdf",
    FileType.DOCX: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}

# PDF names that execute or embed content. Also match the #xx hex-escaped spelling (/J#61vaScript).
_PDF_ACTIVE = re.compile(
    rb"/(?:J(?:#61|a)v(?:#61|a)S(?:#63|c)ript|JS|Launch|EmbeddedFile|RichMedia|XFA)\b"
)
_DOCX_MAX_ENTRIES = 1000
_DOCX_MAX_UNCOMPRESSED = 50 * 1024 * 1024
_DOCX_MAX_RATIO = 200  # compression ratio above this smells like a zip bomb


class InvalidFile(ValueError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class ValidatedFile:
    file_type: FileType
    content_type: str
    safe_name: str


def sanitize_filename(name: str) -> str:
    """Display-only name: no paths, no control chars, NFC, bounded. Never used as a storage key."""
    name = unicodedata.normalize("NFC", name or "")
    name = name.replace("\\", "/").rsplit("/", 1)[-1]
    name = "".join(ch for ch in name if unicodedata.category(ch)[0] != "C")
    name = name.strip().strip(".") or "resume"
    return name[:200]


def _check_pdf(data: bytes) -> None:
    if not data.startswith(b"%PDF-"):
        raise InvalidFile("content_mismatch")
    if b"%%EOF" not in data[-2048:]:
        raise InvalidFile("corrupt_file")
    if _PDF_ACTIVE.search(data):
        raise InvalidFile("unsafe_content")


def _check_docx(data: bytes) -> None:
    if not data.startswith(b"PK\x03\x04"):
        raise InvalidFile("content_mismatch")
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise InvalidFile("corrupt_file") from None
    with zf:
        infos = zf.infolist()
        if len(infos) > _DOCX_MAX_ENTRIES:
            raise InvalidFile("unsafe_content")
        total = sum(i.file_size for i in infos)
        packed = sum(i.compress_size for i in infos) or 1
        if total > _DOCX_MAX_UNCOMPRESSED or total / packed > _DOCX_MAX_RATIO:
            raise InvalidFile("unsafe_content")  # zip bomb
        names = {i.filename for i in infos}
        if any(n.startswith("/") or ".." in n.split("/") for n in names):
            raise InvalidFile("unsafe_content")  # path traversal entries
        if "[Content_Types].xml" not in names or "word/document.xml" not in names:
            raise InvalidFile("content_mismatch")  # a zip, but not a Word document
        if any(n.lower().endswith(("vbaproject.bin", ".bin")) and "vba" in n.lower() for n in names):
            raise InvalidFile("unsafe_content")  # macros
        ctypes = zf.read("[Content_Types].xml")[:200_000]
        if b"macroEnabled" in ctypes or b"vbaProject" in ctypes:
            raise InvalidFile("unsafe_content")


def validate_resume(data: bytes, filename: str) -> ValidatedFile:
    if not data:
        raise InvalidFile("empty_file")
    if len(data) > MAX_RESUME_BYTES:
        raise InvalidFile("file_too_large")
    ext = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
    if ext == "pdf":
        _check_pdf(data)
        ft = FileType.PDF
    elif ext == "docx":
        _check_docx(data)
        ft = FileType.DOCX
    else:
        raise InvalidFile("unsupported_type")
    return ValidatedFile(ft, CONTENT_TYPES[ft], sanitize_filename(filename))
