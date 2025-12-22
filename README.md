Тестовое задание для deBridge (Create a dashboard of DLN order events created and fulfilled on Solana)

### Что делает алгоритм?
Через https://mainnet.helius-rpc.com/ скачивает определенное количество сигнатур 50000 (частями по 100 штук) -> парсит транзакции -> ищет необходимые события Created или FullFilled -> если они есть, то ищет необходимые поля в транзакции -> накапливая определенное количество таких ордеров -> сохраняет их в базу данных в уровень staging -> таблицы нормализуются и сохраняются на уровне silver -> докачиваем данные о ценах токена (использовалось API coingecko), чтобы можно было посчитать объем в usd -> делает view для последующего построения дашборда.

## Точка входа:
./src/main.ts

### Структура результирующей таблицы `gold_orders_view`

| Column | Type | Description |
| :--- | :--- | :--- |
| **time** | timestamp | Время ордера (агрегировано по часам) |
| **status** | varchar | Статус транзакции (`Created` или `Filled`) |
| **symbol** | varchar | Тикер токена (например, SOL, USDC) |
| **amount_usd** | numeric | Чистая стоимость ордера без комиссий USD |
| **percent_fee_usd** | numeric | Переменная комиссия (процентная/приоритетная) USD|
| **fixed_fee_usd** | numeric | Фиксированная базовая комиссия сети USD|
| **total_amount_usd** | numeric | Итоговая сумма в USD (`amount + percent_fee + fixed_fee`) |
| **num_of_orders** | int | Общее кол-во ордеров за этот час для данного символа и статуса |

