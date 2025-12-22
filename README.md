src/
├── domain/                # Бизнес-логика и типы
│   ├── entities/          # Order (Id, Amount, Token, Status)
│   └── repositories/      # Интерфейсы IOrderRepository
├── application/           # Сценарии использования (Use Cases)
│   ├── collect-orders.ts  # Оркестратор: вызывает Fetcher -> пишет в Repo
│   └── get-dashboard.ts   # Логика расчета объемов
├── infrastructure/        # Реализация (Детали)
│   ├── solana/            # SolanaFetcher (работа с RPC, IDL, Signatures)
│   ├── database/          # PostgresRepository (Prisma/SQL, Staging logic)
│   └── cache/             # TokenMetadataCache (хранение decimals)
└── main.ts                # Точка входа (DI Container)