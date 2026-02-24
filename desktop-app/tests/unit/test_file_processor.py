"""
Tests for FileProcessor — Phase B.

Covers:
- TXT extraction with various encodings (UTF-8, UTF-8 BOM, cp1251, KOI8-R)
- PDF extraction (text layer present, no text layer / scan)
- DOCX extraction (paragraphs + tables)
- File validation (extension, size, empty, word count)
- Full pipeline (process_file)
- Encoding detection utility
- Edge cases
"""

import io
import json
import pytest
import shutil
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch, MagicMock

# Ensure desktop-app and project root are on sys.path
DESKTOP_APP_DIR = Path(__file__).resolve().parent.parent.parent
PROJECT_ROOT = DESKTOP_APP_DIR.parent
for p in (str(DESKTOP_APP_DIR), str(PROJECT_ROOT)):
    if p not in sys.path:
        sys.path.insert(0, p)

from services.file_processor import FileProcessor, ExtractionResult, ValidationResult


# ============================================================================
# Fixtures
# ============================================================================


@pytest.fixture
def fp():
    """Default FileProcessor instance."""
    return FileProcessor()


@pytest.fixture
def fp_strict():
    """FileProcessor with strict limits for testing."""
    return FileProcessor(
        max_file_size_mb=1,
        max_word_count=100,
        min_word_count=10,
    )


def _make_txt_bytes(text: str, encoding: str = "utf-8") -> bytes:
    """Helper: encode text to bytes in specified encoding."""
    return text.encode(encoding)


def _make_words(n: int) -> str:
    """Generate text with approximately n words."""
    return " ".join(f"слово{i}" for i in range(n))


# ============================================================================
# TXT extraction
# ============================================================================


class TestExtractTextFromTxt:

    def test_utf8(self):
        text = "Привет мир! Это тест кодировки UTF-8."
        data = _make_txt_bytes(text, "utf-8")
        result, enc = FileProcessor.extract_text_from_txt(data)
        assert result == text
        assert enc == "utf-8"

    def test_utf8_bom(self):
        text = "Текст с BOM"
        data = b"\xef\xbb\xbf" + text.encode("utf-8")
        result, enc = FileProcessor.extract_text_from_txt(data)
        assert result == text
        assert enc == "utf-8"

    def test_cp1251(self):
        text = "Текст в кодировке Windows-1251"
        data = text.encode("cp1251")
        result, enc = FileProcessor.extract_text_from_txt(data)
        # Should decode successfully (via chardet or cp1251 fallback)
        assert "кодировке" in result or "Windows" in result

    def test_koi8r(self):
        text = "Текст в кодировке КОИ-8"
        data = text.encode("koi8-r")
        result, enc = FileProcessor.extract_text_from_txt(data)
        # Should decode somehow — at minimum via lossy fallback
        assert len(result) > 0

    def test_empty_txt(self):
        result, enc = FileProcessor.extract_text_from_txt(b"")
        assert result == ""

    def test_ascii_only(self):
        text = "Hello world, this is plain ASCII text."
        data = text.encode("ascii")
        result, enc = FileProcessor.extract_text_from_txt(data)
        assert result == text
        assert enc == "utf-8"


# ============================================================================
# PDF extraction (mocked — PyMuPDF may not be installed)
# ============================================================================


class TestExtractTextFromPdf:

    def test_pdf_with_text_layer(self):
        """PDF with text returns text and has_text_layer=True."""
        mock_page = MagicMock()
        mock_page.get_text.return_value = "Текст первой страницы PDF документа"

        mock_doc = MagicMock()
        mock_doc.page_count = 2
        mock_doc.__iter__ = MagicMock(return_value=iter([mock_page, mock_page]))

        with patch("services.file_processor.fitz", create=True) as mock_fitz:
            # Make the import inside extract_text_from_pdf succeed
            sys.modules["fitz"] = mock_fitz
            mock_fitz.open.return_value = mock_doc

            text, has_text, pages = FileProcessor.extract_text_from_pdf(b"fake-pdf")
            assert has_text is True
            assert pages == 2
            assert "Текст первой страницы" in text

            del sys.modules["fitz"]

    def test_pdf_without_text_layer(self):
        """PDF scan (no text) returns empty text and has_text_layer=False."""
        mock_page = MagicMock()
        mock_page.get_text.return_value = "   "

        mock_doc = MagicMock()
        mock_doc.page_count = 3
        mock_doc.__iter__ = MagicMock(return_value=iter([mock_page, mock_page, mock_page]))

        with patch("services.file_processor.fitz", create=True) as mock_fitz:
            sys.modules["fitz"] = mock_fitz
            mock_fitz.open.return_value = mock_doc

            text, has_text, pages = FileProcessor.extract_text_from_pdf(b"fake-scan")
            assert has_text is False
            assert pages == 3
            assert text.strip() == ""

            del sys.modules["fitz"]

    def test_has_text_layer_check(self):
        """has_text_layer static method checks first 3 pages."""
        mock_page_empty = MagicMock()
        mock_page_empty.get_text.return_value = ""
        mock_page_text = MagicMock()
        mock_page_text.get_text.return_value = "Some text"

        mock_doc = MagicMock()
        mock_doc.__iter__ = MagicMock(
            return_value=iter([mock_page_empty, mock_page_text])
        )

        with patch("services.file_processor.fitz", create=True) as mock_fitz:
            sys.modules["fitz"] = mock_fitz
            mock_fitz.open.return_value = mock_doc

            assert FileProcessor.has_text_layer(b"pdf-bytes") is True

            del sys.modules["fitz"]


# ============================================================================
# DOCX extraction (mocked — python-docx may not be installed)
# ============================================================================


class TestExtractTextFromDocx:

    def test_docx_with_paragraphs(self):
        """DOCX with paragraphs extracts text."""
        mock_para1 = MagicMock()
        mock_para1.text = "Первый параграф"
        mock_para2 = MagicMock()
        mock_para2.text = "Второй параграф"
        mock_para_empty = MagicMock()
        mock_para_empty.text = "   "

        mock_doc = MagicMock()
        mock_doc.paragraphs = [mock_para1, mock_para_empty, mock_para2]
        mock_doc.tables = []

        with patch("services.file_processor.Document", create=True) as mock_Document:
            # Patch at the module level where it would be imported
            mock_Document.return_value = mock_doc
            with patch.dict("sys.modules", {"docx": MagicMock(Document=mock_Document)}):
                text = FileProcessor.extract_text_from_docx(b"fake-docx")
                assert "Первый параграф" in text
                assert "Второй параграф" in text
                # Empty paragraph should be skipped
                lines = [l for l in text.split("\n") if l.strip()]
                assert len(lines) == 2

    def test_docx_with_tables(self):
        """DOCX tables are also extracted."""
        mock_para = MagicMock()
        mock_para.text = "Параграф"

        mock_cell1 = MagicMock()
        mock_cell1.text = "Ячейка 1"
        mock_cell2 = MagicMock()
        mock_cell2.text = "Ячейка 2"
        mock_cell_dup = MagicMock()
        mock_cell_dup.text = "Ячейка 1"  # duplicate — should be deduplicated

        mock_row = MagicMock()
        mock_row.cells = [mock_cell1, mock_cell2, mock_cell_dup]
        mock_table = MagicMock()
        mock_table.rows = [mock_row]

        mock_doc = MagicMock()
        mock_doc.paragraphs = [mock_para]
        mock_doc.tables = [mock_table]

        with patch("services.file_processor.Document", create=True) as mock_Document:
            mock_Document.return_value = mock_doc
            with patch.dict("sys.modules", {"docx": MagicMock(Document=mock_Document)}):
                text = FileProcessor.extract_text_from_docx(b"fake-docx")
                assert "Параграф" in text
                assert "Ячейка 1" in text
                assert "Ячейка 2" in text
                # Duplicate cell should appear only once
                assert text.count("Ячейка 1") == 1


# ============================================================================
# File validation
# ============================================================================


class TestValidateFile:

    def test_valid_txt(self, fp):
        result = fp.validate_file(b"some content", "file.txt")
        assert result.valid is True

    def test_valid_pdf(self, fp):
        result = fp.validate_file(b"some content", "document.pdf")
        assert result.valid is True

    def test_valid_docx(self, fp):
        result = fp.validate_file(b"some content", "document.docx")
        assert result.valid is True

    def test_unsupported_extension(self, fp):
        result = fp.validate_file(b"data", "file.pptx")
        assert result.valid is False
        assert result.error_code == "unsupported_format"
        assert "pptx" in result.error_message.lower()

    def test_unsupported_jpg(self, fp):
        result = fp.validate_file(b"data", "image.jpg")
        assert result.valid is False
        assert result.error_code == "unsupported_format"

    def test_file_too_large(self, fp_strict):
        big_data = b"x" * (2 * 1024 * 1024)  # 2 MB > 1 MB limit
        result = fp_strict.validate_file(big_data, "file.txt")
        assert result.valid is False
        assert result.error_code == "file_too_large"

    def test_empty_file(self, fp):
        result = fp.validate_file(b"", "file.txt")
        assert result.valid is False
        assert result.error_code == "file_empty"

    def test_case_insensitive_extension(self, fp):
        result = fp.validate_file(b"content", "FILE.TXT")
        assert result.valid is True

    def test_mixed_case_docx(self, fp):
        result = fp.validate_file(b"content", "Document.DOCX")
        assert result.valid is True


# ============================================================================
# Text validation
# ============================================================================


class TestValidateText:

    def test_valid_text(self, fp):
        text = _make_words(100)
        result = fp.validate_text(text)
        assert result.valid is True
        assert result.word_count == 100

    def test_too_few_words(self, fp):
        text = _make_words(10)
        result = fp.validate_text(text)
        assert result.valid is False
        assert result.error_code == "too_few_words"

    def test_exactly_min_words(self, fp):
        text = _make_words(50)
        result = fp.validate_text(text)
        assert result.valid is True

    def test_too_many_words_warning(self, fp_strict):
        text = _make_words(150)
        result = fp_strict.validate_text(text)
        assert result.valid is True  # Still valid, just with warning
        assert len(result.warnings) > 0
        assert "объёмный" in result.warnings[0]


# ============================================================================
# Full pipeline: process_file
# ============================================================================


class TestProcessFile:

    def test_txt_full_pipeline(self, fp):
        text = _make_words(100)
        data = text.encode("utf-8")
        result = fp.process_file(data, "material.txt")
        assert result.ok is True
        assert result.word_count == 100
        assert result.file_info["format"] == "txt"
        assert result.file_info["encoding"] == "utf-8"

    def test_unsupported_format_pipeline(self, fp):
        result = fp.process_file(b"data", "file.xlsx")
        assert result.ok is False
        assert result.error_code == "unsupported_format"

    def test_empty_file_pipeline(self, fp):
        result = fp.process_file(b"", "file.txt")
        assert result.ok is False
        assert result.error_code == "file_empty"

    def test_too_large_pipeline(self, fp_strict):
        data = b"x" * (2 * 1024 * 1024)
        result = fp_strict.process_file(data, "large.txt")
        assert result.ok is False
        assert result.error_code == "file_too_large"

    def test_txt_too_few_words(self, fp):
        data = "Мало слов".encode("utf-8")
        result = fp.process_file(data, "short.txt")
        assert result.ok is False
        assert result.error_code == "too_few_words"

    def test_txt_cp1251_pipeline(self, fp):
        text = _make_words(100)
        data = text.encode("cp1251")
        result = fp.process_file(data, "russian.txt")
        assert result.ok is True
        assert result.word_count >= 50  # Should decode and count

    def test_pdf_no_text_layer(self, fp):
        """PDF scan returns no_text_layer error."""
        mock_page = MagicMock()
        mock_page.get_text.return_value = ""

        mock_doc = MagicMock()
        mock_doc.page_count = 1
        mock_doc.__iter__ = MagicMock(return_value=iter([mock_page]))

        with patch("services.file_processor.fitz", create=True) as mock_fitz:
            sys.modules["fitz"] = mock_fitz
            mock_fitz.open.return_value = mock_doc

            result = fp.process_file(b"fake-scan-pdf", "scan.pdf")
            assert result.ok is False
            assert result.error_code == "no_text_layer"

            del sys.modules["fitz"]

    def test_pdf_with_text(self, fp):
        """PDF with text succeeds."""
        text_content = _make_words(80)
        mock_page = MagicMock()
        mock_page.get_text.return_value = text_content

        mock_doc = MagicMock()
        mock_doc.page_count = 1
        mock_doc.__iter__ = MagicMock(return_value=iter([mock_page]))

        with patch("services.file_processor.fitz", create=True) as mock_fitz:
            sys.modules["fitz"] = mock_fitz
            mock_fitz.open.return_value = mock_doc

            result = fp.process_file(b"fake-text-pdf", "lecture.pdf")
            assert result.ok is True
            assert result.word_count >= 50
            assert result.file_info["has_text_layer"] is True

            del sys.modules["fitz"]

    def test_docx_pipeline(self, fp):
        """DOCX with paragraphs succeeds."""
        words = _make_words(60)
        mock_para = MagicMock()
        mock_para.text = words

        mock_doc = MagicMock()
        mock_doc.paragraphs = [mock_para]
        mock_doc.tables = []

        with patch("services.file_processor.Document", create=True) as mock_Document:
            mock_Document.return_value = mock_doc
            with patch.dict("sys.modules", {"docx": MagicMock(Document=mock_Document)}):
                result = fp.process_file(b"fake-docx", "lecture.docx")
                assert result.ok is True
                assert result.word_count >= 50


# ============================================================================
# Encoding detection
# ============================================================================


class TestDetectEncoding:

    def test_utf8(self):
        data = "Hello world".encode("utf-8")
        assert FileProcessor.detect_encoding(data) == "utf-8"

    def test_utf8_bom(self):
        data = b"\xef\xbb\xbf" + "Hello".encode("utf-8")
        assert FileProcessor.detect_encoding(data) == "utf-8-sig"

    def test_cp1251_detection(self):
        data = "Привет мир".encode("cp1251")
        enc = FileProcessor.detect_encoding(data)
        # Should detect either via chardet or cp1251 fallback
        assert enc in ("cp1251", "windows-1251", "Windows-1251", "MacCyrillic", "unknown")

    def test_empty_bytes(self):
        enc = FileProcessor.detect_encoding(b"")
        assert enc == "utf-8"


# ============================================================================
# Edge cases
# ============================================================================


class TestEdgeCases:

    def test_filename_with_spaces(self, fp):
        text = _make_words(60)
        result = fp.process_file(text.encode("utf-8"), "my document file.txt")
        assert result.ok is True

    def test_filename_cyrillic(self, fp):
        text = _make_words(60)
        result = fp.process_file(text.encode("utf-8"), "лекция_пневмония.txt")
        assert result.ok is True

    def test_filename_no_extension(self, fp):
        result = fp.process_file(b"data", "noextension")
        assert result.ok is False
        assert result.error_code == "unsupported_format"

    def test_double_extension(self, fp):
        text = _make_words(60)
        result = fp.process_file(text.encode("utf-8"), "file.backup.txt")
        assert result.ok is True

    def test_max_word_count_warning(self):
        fp = FileProcessor(max_word_count=100, min_word_count=10)
        text = _make_words(200)
        result = fp.process_file(text.encode("utf-8"), "big.txt")
        assert result.ok is True
        assert len(result.warnings) > 0

    def test_exactly_max_file_size(self):
        fp = FileProcessor(max_file_size_mb=1, min_word_count=1)
        # Exactly 1 MB — should be accepted
        data = b"word " * (1024 * 1024 // 5)
        result = fp.validate_file(data, "file.txt")
        assert result.valid is True

    def test_just_over_max_file_size(self):
        fp = FileProcessor(max_file_size_mb=1, min_word_count=1)
        data = b"x" * (1024 * 1024 + 1)
        result = fp.validate_file(data, "file.txt")
        assert result.valid is False
        assert result.error_code == "file_too_large"
