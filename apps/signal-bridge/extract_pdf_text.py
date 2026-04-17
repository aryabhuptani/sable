#!/usr/bin/env python3

import json
import sys
from pathlib import Path


def emit(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload) + "\n")


def fail(message: str) -> None:
    emit({"ok": False, "error": message})


def main() -> int:
    if len(sys.argv) < 2:
        fail("Missing PDF path.")
        return 1

    pdf_path = Path(sys.argv[1])
    if not pdf_path.exists():
        fail(f"PDF not found: {pdf_path}")
        return 1

    try:
        from pypdf import PdfReader
    except Exception:
        fail(
            "pypdf is not installed for this bridge. Install it with "
            "`python3 -m venv .venv-pdf && .venv-pdf/bin/pip install -r requirements-pdf.txt`."
        )
        return 1

    try:
        reader = PdfReader(str(pdf_path))
    except Exception as exc:
        fail(f"Could not open the PDF: {exc}")
        return 1

    if getattr(reader, "is_encrypted", False):
        try:
            decrypt_result = reader.decrypt("")
        except Exception as exc:
            fail(f"The PDF is encrypted and could not be opened: {exc}")
            return 1

        if decrypt_result == 0:
            fail("The PDF is encrypted and requires a password.")
            return 1

    page_text = []
    for page in reader.pages:
        try:
            extracted = page.extract_text() or ""
        except Exception as exc:
            fail(f"Failed while extracting text from the PDF: {exc}")
            return 1

        normalized = extracted.strip()
        if normalized:
            page_text.append(normalized)

    if not page_text:
        fail("No usable text found in the PDF. It may be scanned/image-only.")
        return 1

    emit({"ok": True, "text": "\n\n".join(page_text)})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
