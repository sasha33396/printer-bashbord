import os
import shutil
from pathlib import Path
from urllib.parse import quote


PHOTO_ROOT = Path(os.getenv("PHOTO_DIRECTORY", "./data/equipment_photos")).resolve()
MAX_PHOTOS_PER_ITEM = 10
MAX_PHOTO_BYTES = 10 * 1024 * 1024

IMAGE_TYPES = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
}


def inventory_folder_name(inventory_number: str) -> str:
    value = inventory_number.strip()
    if not value:
        raise ValueError("Для фотографий нужен инвентарный номер")
    folder = quote(value, safe="-_.() ")
    windows_reserved = {
        "CON", "PRN", "AUX", "NUL",
        *(f"COM{number}" for number in range(1, 10)),
        *(f"LPT{number}" for number in range(1, 10)),
    }
    if (
        folder in {".", ".."}
        or folder.rstrip(" .") != folder
        or folder.split(".", 1)[0].upper() in windows_reserved
    ):
        return "".join(f"%{byte:02X}" for byte in value.encode("utf-8"))
    return folder


def photo_directory(inventory_number: str) -> Path:
    directory = (PHOTO_ROOT / inventory_folder_name(inventory_number)).resolve()
    if directory.parent != PHOTO_ROOT:
        raise ValueError("Некорректный инвентарный номер")
    return directory


def image_extension(header: bytes) -> str | None:
    if header.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if header.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if len(header) >= 12 and header[:4] == b"RIFF" and header[8:12] == b"WEBP":
        return ".webp"
    return None


def photo_files(inventory_number: str) -> list[Path]:
    directory = photo_directory(inventory_number)
    if not directory.is_dir():
        return []
    return sorted(
        (
            path for path in directory.iterdir()
            if path.is_file() and not path.is_symlink() and path.suffix.lower() in IMAGE_TYPES
        ),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )


def photo_file(inventory_number: str, filename: str) -> Path:
    if not filename or Path(filename).name != filename:
        raise ValueError("Некорректное имя файла")
    path = photo_directory(inventory_number) / filename
    if path.suffix.lower() not in IMAGE_TYPES:
        raise ValueError("Некорректный формат файла")
    return path


def move_photo_directory(old_inventory_number: str, new_inventory_number: str) -> bool:
    old_directory = photo_directory(old_inventory_number)
    new_directory = photo_directory(new_inventory_number)
    if old_directory == new_directory or not old_directory.exists():
        return False
    if new_directory.exists():
        raise FileExistsError("Каталог нового инвентарного номера уже существует")
    new_directory.parent.mkdir(parents=True, exist_ok=True)
    old_directory.rename(new_directory)
    return True


def delete_photo_directory(inventory_number: str | None) -> None:
    if not inventory_number:
        return
    directory = photo_directory(inventory_number)
    if directory.exists():
        shutil.rmtree(directory)
