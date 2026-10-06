import os
import re
import shutil
import hashlib
from uuid import uuid4
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


def equipment_photo_key(kind: str, entity_id: int, inventory_number: str | None) -> str:
    """Unlabelled assets own a separate album; released numbers can be reused."""
    if kind not in {"device", "warehouse_item"} or not isinstance(entity_id, int) or entity_id < 1:
        raise ValueError("Некорректная карточка оборудования")
    return (inventory_number or "").strip() or f"unassigned-{kind}-{entity_id}"


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


def photo_digest(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


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


def normalize_photo_filenames(inventory_number: str) -> list[Path]:
    directory = photo_directory(inventory_number)
    files = sorted(photo_files(inventory_number), key=lambda path: (path.stat().st_mtime, path.name))
    if not files:
        return []

    temporary: list[tuple[Path, str]] = []
    for path in files:
        extension = ".jpg" if path.suffix.lower() in {".jpg", ".jpeg"} else path.suffix.lower()
        temp_path = directory / f".{uuid4().hex}.tmp"
        path.rename(temp_path)
        temporary.append((temp_path, extension))

    result = []
    for index, (temp_path, extension) in enumerate(temporary, start=1):
        target = directory / f"{inventory_number}_{index:04d}{extension}"
        temp_path.rename(target)
        result.append(target)
    return result


def next_photo_filename(inventory_number: str, extension: str) -> str:
    pattern = re.compile(
        rf"^{re.escape(inventory_number)}_(\d{{4}})\.(?:jpe?g|png|webp)$",
        re.IGNORECASE,
    )
    indexes = []
    for path in photo_files(inventory_number):
        match = pattern.fullmatch(path.name)
        if match:
            indexes.append(int(match.group(1)))
    return f"{inventory_number}_{max(indexes, default=0) + 1:04d}{extension}"


def move_photo_directory(old_inventory_number: str, new_inventory_number: str) -> bool:
    old_directory = photo_directory(old_inventory_number)
    new_directory = photo_directory(new_inventory_number)
    if old_directory == new_directory or not old_directory.exists():
        return False
    if new_directory.exists():
        raise FileExistsError("Каталог нового инвентарного номера уже существует")
    new_directory.parent.mkdir(parents=True, exist_ok=True)
    old_directory.rename(new_directory)
    normalize_photo_filenames(new_inventory_number)
    return True


def delete_photo_directory(inventory_number: str | None) -> None:
    if not inventory_number:
        return
    directory = photo_directory(inventory_number)
    if directory.exists():
        shutil.rmtree(directory)
