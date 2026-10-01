import os
import shutil
from pathlib import Path


INVOICE_ROOT = Path(os.getenv("REPAIR_INVOICE_DIRECTORY", "./data/repair_invoices")).resolve()
MAX_INVOICE_BYTES = 20 * 1024 * 1024


def invoice_directory(repair_id: int) -> Path:
    if repair_id < 1:
        raise ValueError("Некорректный номер ремонта")
    directory = (INVOICE_ROOT / str(repair_id)).resolve()
    if directory.parent != INVOICE_ROOT:
        raise ValueError("Некорректный путь счёта")
    return directory


def invoice_file(repair_id: int) -> Path:
    return invoice_directory(repair_id) / "invoice.pdf"


def delete_invoice(repair_id: int) -> None:
    directory = invoice_directory(repair_id)
    if directory.exists():
        shutil.rmtree(directory)
