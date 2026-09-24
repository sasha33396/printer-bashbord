import unittest

from photo_storage import image_extension, inventory_folder_name


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


if __name__ == "__main__":
    unittest.main()
