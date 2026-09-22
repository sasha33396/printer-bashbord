import unittest

from stock import movement_delta


class StockMovementTests(unittest.TestCase):
    def test_receipt_and_issue(self):
        self.assertEqual(movement_delta("receipt", 7), 7)
        self.assertEqual(movement_delta("issue", 3), -3)

    def test_invalid_movement(self):
        for movement_type, quantity in (("receipt", 0), ("issue", -1), ("other", 1)):
            with self.subTest(movement_type=movement_type, quantity=quantity):
                with self.assertRaises(ValueError):
                    movement_delta(movement_type, quantity)


if __name__ == "__main__":
    unittest.main()
