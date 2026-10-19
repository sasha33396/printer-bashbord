import re
import unicodedata

_ALPHABET = 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя'
_WEIGHTS = {letter: ord('а') + index for index, letter in enumerate(_ALPHABET)}
_DIGITS = re.compile(r'(\d+)')


def natural_text_key(value):
    """Case-insensitive Russian text with numeric runs ordered as integers."""
    text = unicodedata.normalize('NFC', value).strip().casefold()
    # Place ё immediately after е, independently of the OS locale.
    return tuple((0, int(part)) if part.isdecimal() else
                 (1, tuple(_WEIGHTS.get(letter, ord(letter)) for letter in part))
                 for part in _DIGITS.split(text))


def compare_natural_text(left, right):
    a, b = natural_text_key(left), natural_text_key(right)
    return (a > b) - (a < b)
