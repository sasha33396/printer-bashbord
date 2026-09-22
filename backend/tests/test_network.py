import unittest

from network import normalize_ip_address


class IPAddressTests(unittest.TestCase):
    def test_optional_address(self):
        for value in (None, "", "   "):
            with self.subTest(value=value):
                self.assertIsNone(normalize_ip_address(value))

    def test_valid_addresses(self):
        self.assertEqual(normalize_ip_address(" 192.168.1.100 "), "192.168.1.100")
        self.assertEqual(normalize_ip_address("2001:0db8:0:0::1"), "2001:db8::1")

    def test_invalid_addresses(self):
        for value in ("999.1.1.1", "printer.local", "http://192.168.1.1",
                      "192.168.1.1:80", "192.168.1.0/24", "fe80::1%eth0", 123):
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    normalize_ip_address(value)


if __name__ == "__main__":
    unittest.main()
