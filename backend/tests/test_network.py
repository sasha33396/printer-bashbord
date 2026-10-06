import unittest

from network import normalize_ip_address, normalize_mac_address


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


class MACAddressTests(unittest.TestCase):
    def test_optional_address(self):
        for value in (None, "", "   "):
            with self.subTest(value=value):
                self.assertIsNone(normalize_mac_address(value))

    def test_valid_addresses_are_normalized(self):
        for value in ("aa:bb:cc:dd:ee:ff", "AA-BB-CC-DD-EE-FF", "aabb.ccdd.eeff", "aabbccddeeff"):
            with self.subTest(value=value):
                self.assertEqual(normalize_mac_address(value), "AA:BB:CC:DD:EE:FF")

    def test_invalid_addresses(self):
        for value in ("AA:BB:CC:DD:EE", "GG:BB:CC:DD:EE:FF", "printer", 123):
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    normalize_mac_address(value)


if __name__ == "__main__":
    unittest.main()
