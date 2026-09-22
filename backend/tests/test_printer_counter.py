import unittest
from unittest.mock import MagicMock, patch

from printer_counter import (
    COUNTER_PATH, MAX_RESPONSE_BYTES, calculate_counter_delta, parse_counter, read_counter,
)


def response_source(copy=3468, printed=60070, fax=0):
    return "\n".join(
        f"_pp.{field} = ('{value}').toString();"
        for field, value in (("copytotal", copy), ("printertotal", printed), ("faxTotal", fax))
    )


class PrinterCounterTests(unittest.TestCase):
    def test_counter_delta(self):
        self.assertEqual(calculate_counter_delta(63538, 64000), 462)
        self.assertEqual(calculate_counter_delta(100, 100), 0)

    def test_counter_delta_rejects_missing_or_decreased_counter(self):
        for start, end in ((None, 100), (101, 100)):
            with self.subTest(start=start, end=end):
                with self.assertRaises(ValueError):
                    calculate_counter_delta(start, end)

    def test_total_and_zero(self):
        self.assertEqual(parse_counter(response_source()), 63538)
        self.assertEqual(parse_counter(response_source(0, 0, 0)), 0)

    def test_unrecognized_or_partial_response_is_not_zero(self):
        for source in ("", "<html>Login</html>", response_source().replace("printertotal", "other"),
                       response_source(printed=-1), response_source() + response_source()):
            with self.subTest(source=source):
                with self.assertRaises(ValueError):
                    parse_counter(source)

    @patch("printer_counter.build_opener")
    def test_requests_the_supplied_address(self, build):
        response = MagicMock()
        response.read.return_value = response_source().encode()
        build.return_value.open.return_value.__enter__.return_value = response
        for address, host in (("192.168.10.50", "192.168.10.50"),
                              ("10.0.0.25", "10.0.0.25"), ("2001:db8::1", "[2001:db8::1]")):
            self.assertEqual(read_counter(address), 63538)
            request = build.return_value.open.call_args.args[0]
            self.assertEqual(request.full_url, f"http://{host}{COUNTER_PATH}")
            self.assertEqual(build.return_value.open.call_args.kwargs["timeout"], 8)

    @patch("printer_counter.build_opener")
    def test_no_request_without_valid_ip(self, build):
        for address in ("", "http://example.com", "printer.local"):
            with self.assertRaises(ValueError):
                read_counter(address)
        build.assert_not_called()

    @patch("printer_counter.build_opener")
    def test_oversized_response(self, build):
        response = build.return_value.open.return_value.__enter__.return_value
        response.read.return_value = b"x" * (MAX_RESPONSE_BYTES + 1)
        with self.assertRaises(ValueError):
            read_counter("192.168.10.50")


if __name__ == "__main__":
    unittest.main()
