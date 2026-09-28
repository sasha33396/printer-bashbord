import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from photo_storage import image_extension, inventory_folder_name, normalize_photo_filenames


class PhotoStorageTests(unittest.TestCase):
    def test_inventory_folder_is_safe_and_reversible_in_name(self):
        self.assertEqual(inventory_folder_name(" PC/01 "), "PC%2F01")
        self.assertEqual(inventory_folder_name("ПК 01"), "%D0%9F%D0%9A 01")
        self.assertEqual(inventory_folder_name(".."), "%2E%2E")
        self.assertEqual(inventory_folder_name("CON"), "%43%4F%4E")

    def test_supported_image_signatures(self):
        self.assertEqual(image_extension(b"\xff\xd8\xff\xe0"), ".jpg")
        self.assertEqual(image_extension(b"\x89PNG\r\n\x1a\n"), ".png")
        self.assertEqual(image_extension(b"RIFF\x00\x00\x00\x00WEBP"), ".webp")
        self.assertIsNone(image_extension(b"not an image"))

    def test_photo_names_follow_inventory_number(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root) / "1-00001"
            directory.mkdir()
            first = directory / "old-name.jpeg"
            second = directory / "another.png"
            first.write_bytes(b"first")
            second.write_bytes(b"second")
            os.utime(first, (1, 1))
            os.utime(second, (2, 2))

            with patch("photo_storage.PHOTO_ROOT", Path(root).resolve()):
                result = normalize_photo_filenames("1-00001")

            self.assertEqual(
                [path.name for path in result],
                ["1-00001_0001.jpg", "1-00001_0002.png"],
            )


if __name__ == "__main__":
    unittest.main()
