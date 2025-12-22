type OrderStatus = "created" | "filled";

export interface TransactionParserResult {
    orderId: string;
    status: OrderStatus;
    amount: number;
    timestamp: number; // timestamp in seconds
    tokenSymbol: string; // symbol of the token
    tokenKey: string; // key of the token
    percentFee?: number; // percent fee of the order
    fixedFee?: number; // fixed fee of the order
}

interface ParsedOrder {
    orderId: string;
    amount: number;
    tokenKey: string;
    tokenSymbol: string;
    status: OrderStatus;
}

export interface ParsedOrderCreated extends ParsedOrder {
    percentFee: number;
    fixedFee: number;
}

export interface ParsedOrderFilled extends ParsedOrder {
}

export interface OrderInfoResult extends TransactionParserResult {
    signature: string;
}