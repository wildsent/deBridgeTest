import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventParser, BorshCoder, Event } from '@coral-xyz/anchor';
import { Connection, PublicKey } from '@solana/web3.js';
import { OrderCreatedParser } from '../src/scrapper/order_created_parser';
import { TokensInfoCache } from '../src/infrastructure/tokens_info_cache';
import { ParsedOrderCreated } from '../src/interfaces/scrapper_interfaces';
import { TokenInfo } from '../src/interfaces/infrastructure_interfaces';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { IDL as DlnSrcIdl } from '../src/idl/src';

// Mock global fetch
global.fetch = vi.fn();

// Load test transaction data
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testDataDir = path.join(__dirname, 'tests_data');
const testTransactionFile = path.join(testDataDir, 'tx_2zhQdZCFiVUxk2wrGE9ukNPtDca9Vy9z1HG6cnYauh4S54mNdBQ7TMSLXasmV5Bv2VbR1QqEY1ewLRf3nCgdLqLc.json');

function loadTransactionFromFile(): any {
    const fileContent = fs.readFileSync(testTransactionFile, 'utf-8');
    return JSON.parse(fileContent);
}

function parseEventsFromTransaction(transaction: any): Event[] {
    const DLN_SRC_PROGRAM_ID = 'src5qyZHqTqecJV4aY6Cb6zDZLMDzrDKKezs22MPHr4';
    const srcCoder = new BorshCoder(DlnSrcIdl);
    const srcEventParser = new EventParser(new PublicKey(DLN_SRC_PROGRAM_ID), srcCoder);
    const logMessages = transaction?.meta?.logMessages || [];
    return Array.from(srcEventParser.parseLogs(logMessages));
}

describe('OrderCreatedParser', () => {
    let parser: OrderCreatedParser;
    let mockConnection: Connection;
    let mockTokensInfo: TokensInfoCache;
    let testTransaction: any;
    let testEvents: Event[];

    beforeEach(() => {
        vi.clearAllMocks();
        parser = new OrderCreatedParser();
        mockConnection = {} as Connection;
        mockTokensInfo = {
            getTokenInfo: vi.fn()
        } as any;
        
        // Load real transaction and parse events
        testTransaction = loadTransactionFromFile();
        testEvents = parseEventsFromTransaction(testTransaction);
    });

    describe('parseOrderCreatedEvent', () => {
        it('should parse order created event from real transaction', async () => {
            const tokenPublicKey = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
            const mockTokenInfo: TokenInfo = {
                key: tokenPublicKey.toString(),
                symbol: 'USDC',
                precision: 6
            };

            vi.mocked(mockTokensInfo.getTokenInfo).mockResolvedValue(mockTokenInfo);

            const result = await parser.parseOrderCreatedEvent(testEvents, mockTokensInfo);

            expect(result).not.toBeNull();
            expect(Array.isArray(result)).toBe(true);
            expect(result!.length).toBeGreaterThan(0);
            
            const order = result![0];
            expect(order).toHaveProperty('status', 'created');
            expect(order).toHaveProperty('percentFee');
            expect(order).toHaveProperty('fixedFee');
            expect(order).toHaveProperty('tokenSymbol');
            
            // Check specific values for orderId, tokenKey and amount
            expect(order.orderId).toBe('291438b251464b56304ffab86e7690385fbcdcc8d046ead858853446bad5e3b0');
            expect(order.tokenKey).toBe('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
            expect(order.amount).toBeCloseTo(101.314781, 5);
        });

        it('should return null if CreatedOrderId event is missing', async () => {
            const eventsWithoutId: Event[] = testEvents.filter(e => e.name !== 'CreatedOrderId');

            const result = await parser.parseOrderCreatedEvent(eventsWithoutId, mockTokensInfo);

            expect(result).toBeNull();
        });

        it('should return null if CreatedOrder event is missing', async () => {
            const eventsWithoutOrder: Event[] = testEvents.filter(e => e.name !== 'CreatedOrder');

            const result = await parser.parseOrderCreatedEvent(eventsWithoutOrder, mockTokensInfo);

            expect(result).toBeNull();
        });

        it('should return null if events array is empty', async () => {
            const result = await parser.parseOrderCreatedEvent([], mockTokensInfo);

            expect(result).toBeNull();
        });

        it('should use default values when token info is not available', async () => {
            vi.mocked(mockTokensInfo.getTokenInfo).mockResolvedValue(null);

            const result = await parser.parseOrderCreatedEvent(testEvents, mockTokensInfo);

            expect(result).not.toBeNull();
            const order = result![0];
            expect(order.tokenSymbol).toBe('USDC');
            expect(order.tokenKey).toBe('USDC');
        });


    });

    describe('_getAmountFromOrderEvent', () => {
        it('should calculate amount correctly with given decimals', () => {
            const orderEvent = testEvents.find(e => e.name === 'CreatedOrder');
            if (!orderEvent) {
                return;
            }

            const tokenInfo: TokenInfo = {
                key: 'test',
                symbol: 'USDC',
                precision: 6
            };
            vi.mocked(mockTokensInfo.getTokenInfo).mockResolvedValue(tokenInfo);

            const amount = parser._getAmountFromOrderEvent(orderEvent, 6);

            expect(typeof amount).toBe('number');
            expect(amount).toBeGreaterThanOrEqual(0);
            expect(amount).toBeCloseTo(101.314781, 5);
        });

        it('should return 0 if giveAmountRaw is missing', () => {
            const mockEvent: Event = {
                name: 'CreatedOrder',
                data: {}
            } as Event;

            const amount = parser._getAmountFromOrderEvent(mockEvent, 6);

            expect(amount).toBe(0);
        });

        it('should handle different decimal precisions', () => {
            const orderEvent = testEvents.find(e => e.name === 'CreatedOrder');
            if (!orderEvent) {
                return;
            }

            const amount6 = parser._getAmountFromOrderEvent(orderEvent, 6);
            const amount9 = parser._getAmountFromOrderEvent(orderEvent, 9);

            expect(typeof amount6).toBe('number');
            expect(typeof amount9).toBe('number');
            expect(amount6).not.toBe(amount9);
        });
    });

    describe('_getFeeFromOrderEvent', () => {
        it('should calculate percentFee correctly', () => {
            const orderEvent = testEvents.find(e => e.name === 'CreatedOrder');
            if (!orderEvent) {
                return;
            }

            const percentFee = parser._getFeeFromOrderEvent(orderEvent, 'percentFee', 6);

            expect(typeof percentFee).toBe('number');
            expect(percentFee).toBeGreaterThanOrEqual(0);
        });

        it('should calculate fixedFee correctly', () => {
            const orderEvent = testEvents.find(e => e.name === 'CreatedOrder');
            if (!orderEvent) {
                return;
            }

            const fixedFee = parser._getFeeFromOrderEvent(orderEvent, 'fixedFee', 6);

            expect(typeof fixedFee).toBe('number');
            expect(fixedFee).toBeGreaterThanOrEqual(0);
        });

        it('should return 0 if fee field is missing', () => {
            const mockEvent: Event = {
                name: 'CreatedOrder',
                data: {}
            } as Event;

            const fee = parser._getFeeFromOrderEvent(mockEvent, 'percentFee', 6);

            expect(fee).toBe(0);
        });

        it('should handle different decimal precisions for fees', () => {
            const orderEvent = testEvents.find(e => e.name === 'CreatedOrder');
            if (!orderEvent) {
                return;
            }

            const fee6 = parser._getFeeFromOrderEvent(orderEvent, 'percentFee', 6);
            const fee9 = parser._getFeeFromOrderEvent(orderEvent, 'percentFee', 9);

            expect(typeof fee6).toBe('number');
            expect(typeof fee9).toBe('number');
        });
    });

    describe('_getTokenInfoFromOrderEvent', () => {
        it('should extract token address from order event', async () => {
            const orderEvent = testEvents.find(e => e.name === 'CreatedOrder');
            if (!orderEvent) {
                return;
            }

            const tokenPublicKey = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
            const mockTokenInfo: TokenInfo = {
                key: tokenPublicKey.toString(),
                symbol: 'USDC',
                precision: 6
            };

            vi.mocked(mockTokensInfo.getTokenInfo).mockResolvedValue(mockTokenInfo);

            const result = await parser._getTokenInfoFromOrderEvent(orderEvent, mockTokensInfo);

            expect(result).not.toBeNull();
            expect(mockTokensInfo.getTokenInfo).toHaveBeenCalled();
        });

        it('should return null if tokenAddressBytes is missing', async () => {
            const mockEvent: Event = {
                name: 'CreatedOrder',
                data: {}
            } as Event;

            const result = await parser._getTokenInfoFromOrderEvent(mockEvent, mockTokensInfo);

            expect(result).toBeNull();
            expect(mockTokensInfo.getTokenInfo).not.toHaveBeenCalled();
        });

        it('should return null if tokenAddressBytes is in order but not in give', async () => {
            const mockEvent: Event = {
                name: 'CreatedOrder',
                data: {
                    order: {}
                }
            } as Event;

            const result = await parser._getTokenInfoFromOrderEvent(mockEvent, mockTokensInfo);

            expect(result).toBeNull();
        });

        it('should handle PublicKey creation errors', async () => {
            const mockEvent: Event = {
                name: 'CreatedOrder',
                data: {
                    order: {
                        give: {
                            tokenAddress: new Uint8Array([1, 2, 3])
                        }
                    }
                }
            } as Event;

            vi.mocked(mockTokensInfo.getTokenInfo).mockResolvedValue(null);

            const result = await parser._getTokenInfoFromOrderEvent(mockEvent, mockTokensInfo);

            // Should handle error and try alternative PublicKey creation
            expect(mockTokensInfo.getTokenInfo).toHaveBeenCalled();
        });
    });
});

