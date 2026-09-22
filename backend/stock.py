def movement_delta(movement_type: str, quantity: int) -> int:
    if quantity <= 0:
        raise ValueError("Количество должно быть больше нуля")
    if movement_type == "receipt":
        return quantity
    if movement_type == "issue":
        return -quantity
    raise ValueError("Неизвестный тип движения")
