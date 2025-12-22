import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventParser, BorshCoder, Event } from '@coral-xyz/anchor';
import { Connection, PublicKey, ParsedTransactionWithMeta } from '@solana/web3.js';
import { OrderFulfilledParser } from '../src/scrapper/order_fulfilled_parser';
import { TokensInfoCache } from '../src/infrastructure/tokens_info_cache';
import { ParsedOrderFilled } from '../src/interfaces/scrapper_interfaces';
import { TokenInfo } from '../src/interfaces/infrastructure_interfaces';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { IDL } from '../src/idl/dst';

// Mock global fetch
global.fetch = vi.fn();

// Load test transaction data
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testDataDir = path.join(__dirname, 'tests_data');
const testTransactionFile = path.join(testDataDir, 'tx_3qQSDktLZrvPd2QMEkBtxJmpE1jJeHE88Nzws3rgZAmmzTpa46RaWh4bkfXStXDKCprZd8NAYct8qMnBDQn3MC77.json');
const testTransactionFile2 = path.join(testDataDir, 'tx_TKY49Kw2QRZnw7hiTZEqDTD9d2YLUsXA6Qt5oCdknhxn9Q5myCehzV24Z6WpBdWaQcKNvLMqpqbyMqjaqjWkRV8.json');

function loadTransactionFromFile(): ParsedTransactionWithMeta {
    const fileContent = fs.readFileSync(testTransactionFile, 'utf-8');
    return JSON.parse(fileContent) as ParsedTransactionWithMeta;
}

function parseEventsFromTransaction(transaction: ParsedTransactionWithMeta): Event[] {
    const DLN_DST_PROGRAM_ID = 'dst5MGcFPoBeREFAA5E3tU5ij8m5uVYwkzkSAbsLbNo';
    const dstCoder = new BorshCoder(IDL);
    const dstEventParser = new EventParser(new PublicKey(DLN_DST_PROGRAM_ID), dstCoder);
    const logMessages = transaction?.meta?.logMessages || [];
    return Array.from(dstEventParser.parseLogs(logMessages));
}

describe('OrderFulfilledParser', () => {
    let parser: OrderFulfilledParser;
    let mockConnection: Connection;
    let mockTokensInfo: TokensInfoCache;
    let testTransaction: ParsedTransactionWithMeta;
    let testEvents: Event[];
    const dstProgramID = new PublicKey('dst5MGcFPoBeREFAA5E3tU5ij8m5uVYwkzkSAbsLbNo');

    beforeEach(() => {
        vi.clearAllMocks();
        parser = new OrderFulfilledParser(dstProgramID);
        mockConnection = {} as Connection;
        mockTokensInfo = {
            getTokenInfo: vi.fn()
        } as any;
        
        // Load real transaction and parse events
        testTransaction = loadTransactionFromFile();
        testEvents = parseEventsFromTransaction(testTransaction);
    });

    describe('constructor', () => {
        it('should create instance with valid dstProgramID', () => {
            const parserInstance = new OrderFulfilledParser(dstProgramID);
            expect(parserInstance).toBeInstanceOf(OrderFulfilledParser);
        });

        it('should throw error if dstProgramID is null', () => {
            expect(() => {
                new OrderFulfilledParser(null as any);
            }).toThrow('DLN_DST_PROGRAM_ID is not set');
        });
    });

    describe('parseOrderFilledEvent', () => {
        it('should parse order filled event from real transaction', async () => {
            const solPublicKey = new PublicKey('So11111111111111111111111111111111111111112');
            const mockTokenInfo: TokenInfo = {
                key: solPublicKey.toString(),
                symbol: 'SOL',
                precision: 9
            };

            vi.mocked(mockTokensInfo.getTokenInfo).mockResolvedValue(mockTokenInfo);

            const result = await parser.parseOrderFilledEvent(testEvents, mockTokensInfo, testTransaction);

            expect(result).not.toBeNull();
            expect(Array.isArray(result)).toBe(true);
            expect(result!.length).toBeGreaterThan(0);
            
            const order = result![0];
            expect(order).toHaveProperty('status', 'filled');
            expect(order).toHaveProperty('amount');
            expect(order).toHaveProperty('tokenSymbol');
            expect(order).toHaveProperty('tokenKey');
            
            // Check specific values for orderId, tokenKey and amount
            expect(order.orderId).toBe('76ef49d302f1c30f8b3b0e3f1b294b604c5245a7566c0b05c1279a525dfb703c');
            expect(order.tokenKey).toBe('So11111111111111111111111111111111111111112');
            expect(order.amount).toBeCloseTo(3.919776213, 5);
        });

        it('should parse order filled event from SPL token transaction', async () => {
            const testTransaction2 = JSON.parse(fs.readFileSync(testTransactionFile2, 'utf-8')) as ParsedTransactionWithMeta;
            const testEvents2 = parseEventsFromTransaction(testTransaction2);
            
            const solPublicKey = new PublicKey('So11111111111111111111111111111111111111112');
            const mockTokenInfo: TokenInfo = {
                key: solPublicKey.toString(),
                symbol: 'SOL',
                precision: 9
            };

            vi.mocked(mockTokensInfo.getTokenInfo).mockResolvedValue(mockTokenInfo);

            const result = await parser.parseOrderFilledEvent(testEvents2, mockTokensInfo, testTransaction2);

            expect(result).not.toBeNull();
            expect(Array.isArray(result)).toBe(true);
            expect(result!.length).toBeGreaterThan(0);
            
            const order = result![0];
            expect(order).toHaveProperty('status', 'filled');
            expect(order).toHaveProperty('amount');
            expect(order).toHaveProperty('tokenSymbol');
            expect(order).toHaveProperty('tokenKey');
            
            // Check specific values for orderId, tokenKey and amount
            // Parser correctly selects SOL transfer with 808590964 lamports = 0.808590964 SOL
            expect(order.orderId).toBe('063d9ddfcb55a466c470295188d0b75e62675de8af039f1175fa433d21f7ef0d');
            expect(order.tokenKey).toBe('So11111111111111111111111111111111111111112');
            expect(order.amount).toBeCloseTo(0.808590964, 5);
        });

        it('should return null if Fulfilled events are missing', async () => {
            const emptyEvents: Event[] = [];

            const result = await parser.parseOrderFilledEvent(emptyEvents, mockTokensInfo, testTransaction);

            expect(result).toBeNull();
        });

        it('should return null if fulfilled events inst indexes mismatch', async () => {
            // Create a transaction where fulfilledEventsInstIndexes.length !== fulfilledEventsIDs.length
            // Remove FulfillOrder from logMessages so indexes will be empty but events will have IDs
            const modifiedTransaction = {
                ...testTransaction,
                meta: {
                    ...testTransaction.meta,
                    logMessages: testTransaction?.meta?.logMessages?.filter((msg: string) => !msg.includes('FulfillOrder'))
                }
            } as ParsedTransactionWithMeta;

            const result = await parser.parseOrderFilledEvent(testEvents, mockTokensInfo, modifiedTransaction);

            // Parser returns null when indexes mismatch (fulfilledEventsInstIndexes.length !== fulfilledEventsIDs.length)
            // fulfilledEventsInstIndexes will be [] (no FulfillOrder in logs) but fulfilledEventsIDs will have items from testEvents
            expect(result).toBeNull();
        });

        it('should handle missing transfer inner instruction gracefully', async () => {
            const solPublicKey = new PublicKey('So11111111111111111111111111111111111111112');
            const mockTokenInfo: TokenInfo = {
                key: solPublicKey.toString(),
                symbol: 'SOL',
                precision: 9
            };

            vi.mocked(mockTokensInfo.getTokenInfo).mockResolvedValue(mockTokenInfo);

            // Create transaction where inner instructions don't have transfer instructions
            // This will cause _getTransferInnerInstruction to return null, and parser will skip that order
            // but continue processing, returning an empty array if no valid orders found
            const modifiedTransaction = {
                ...testTransaction,
                meta: {
                    ...testTransaction.meta,
                    innerInstructions: [{
                        index: 1,
                        instructions: [{
                            parsed: {
                                type: 'createAccount',
                                info: {}
                            }
                        }]
                    }]
                }
            } as ParsedTransactionWithMeta;

            const result = await parser.parseOrderFilledEvent(testEvents, mockTokensInfo, modifiedTransaction);

            // Parser continues processing and skips orders without transfer instructions
            // Returns empty array if no valid orders found
            expect(result).toEqual([]);
        });

        it('should handle missing token info gracefully', async () => {
            vi.mocked(mockTokensInfo.getTokenInfo).mockResolvedValue(null);

            const result = await parser.parseOrderFilledEvent(testEvents, mockTokensInfo, testTransaction);

            // Parser continues processing even if token info is missing (uses default values)
            // So it returns an array, not null
            expect(result).not.toBeNull();
            expect(Array.isArray(result)).toBe(true);
        });
    });

    describe('_getAmountFromInstruction', () => {
        it('should calculate amount correctly for SOL transfer', () => {
            const mockInstruction = {
                programId: new PublicKey('11111111111111111111111111111111'),
                parsed: {
                    info: {
                        lamports: 3919776213
                    }
                }
            } as any;

            const tokenInfo: TokenInfo = {
                key: 'So11111111111111111111111111111111111111112',
                symbol: 'SOL',
                precision: 9
            };

            const amount = parser._getAmountFromInstruction(mockInstruction, tokenInfo);

            expect(amount).toBeCloseTo(3.919776213, 5);
        });

        it('should calculate amount correctly for SPL token transfer', () => {
            const mockInstruction = {
                programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
                program: 'spl-token',
                parsed: {
                    info: {
                        tokenAmount: {
                            amount: '1000000'
                        }
                    }
                }
            } as any;

            const tokenInfo: TokenInfo = {
                key: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
                symbol: 'USDC',
                precision: 6
            };

            const amount = parser._getAmountFromInstruction(mockInstruction, tokenInfo);

            expect(amount).toBeCloseTo(1.0, 5);
        });

        it('should return 0 if parsedData is missing', () => {
            const mockInstruction = {
                programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
                parsed: null
            } as any;

            const tokenInfo: TokenInfo = {
                key: 'test',
                symbol: 'TEST',
                precision: 6
            };

            const amount = parser._getAmountFromInstruction(mockInstruction, tokenInfo);

            expect(amount).toBe(0);
        });

        it('should return 0 for unknown program', () => {
            const mockInstruction = {
                programId: new PublicKey('11111111111111111111111111111112'),
                program: 'unknown-program',
                parsed: {
                    info: {
                        amount: '1000000'
                    }
                }
            } as any;

            const tokenInfo: TokenInfo = {
                key: 'test',
                symbol: 'TEST',
                precision: 6
            };

            const amount = parser._getAmountFromInstruction(mockInstruction, tokenInfo);

            expect(amount).toBe(0);
        });
    });

    describe('_getTransferInnerInstruction', () => {
        it('should find transfer instruction in inner instructions', () => {
            const instIndex = 1;
            const instruction = parser._getTransferInnerInstruction(testTransaction, instIndex);

            expect(instruction).not.toBeNull();
            expect(instruction?.parsed?.type).toBe('transfer');
        });

        it('should return null if inner instruction not found', () => {
            const instIndex = 999;
            const instruction = parser._getTransferInnerInstruction(testTransaction, instIndex);

            expect(instruction).toBeNull();
        });

        it('should find transferChecked instruction', () => {
            // Create mock transaction with transferChecked
            const mockTransaction = {
                ...testTransaction,
                meta: {
                    ...testTransaction.meta,
                    innerInstructions: [{
                        index: 1,
                        instructions: [{
                            parsed: {
                                type: 'transferChecked',
                                info: {}
                            }
                        }]
                    }]
                }
            } as ParsedTransactionWithMeta;

            const instruction = parser._getTransferInnerInstruction(mockTransaction, 1);

            expect(instruction).not.toBeNull();
            expect(instruction?.parsed?.type).toBe('transferChecked');
        });
    });

    describe('_getFulfilledEventsInstIndexes', () => {
        it('should find fulfilled events instruction indexes', () => {
            const indexes = parser._getFulfilledEventsInstIndexes(testTransaction, dstProgramID, 'FulfillOrder');

            expect(Array.isArray(indexes)).toBe(true);
            expect(indexes.length).toBeGreaterThan(0);
        });

        it('should return empty array if no fulfilled events found', () => {
            const mockTransaction = {
                ...testTransaction,
                meta: {
                    ...testTransaction.meta,
                    logMessages: []
                }
            } as ParsedTransactionWithMeta;

            const indexes = parser._getFulfilledEventsInstIndexes(mockTransaction, dstProgramID, 'FulfillOrder');

            expect(indexes).toEqual([]);
        });
    });

    describe('_getTokenInfoFromInstruction', () => {
        it('should return SOL token info for system program', async () => {
            const mockInstruction = {
                programId: new PublicKey('11111111111111111111111111111111')
            } as any;

            const solPublicKey = new PublicKey('So11111111111111111111111111111111111111112');
            const mockTokenInfo: TokenInfo = {
                key: solPublicKey.toString(),
                symbol: 'SOL',
                precision: 9
            };

            vi.mocked(mockTokensInfo.getTokenInfo).mockResolvedValue(mockTokenInfo);

            const result = await parser._getTokenInfoFromInstruction(mockInstruction, mockTokensInfo);

            expect(result).not.toBeNull();
            expect(result?.symbol).toBe('SOL');
            expect(result?.key).toBe(solPublicKey.toString());
        });

        it('should return default SOL token info if cache returns null', async () => {
            const mockInstruction = {
                programId: new PublicKey('11111111111111111111111111111111')
            } as any;

            vi.mocked(mockTokensInfo.getTokenInfo).mockResolvedValue(null);

            const result = await parser._getTokenInfoFromInstruction(mockInstruction, mockTokensInfo);

            expect(result).not.toBeNull();
            expect(result?.symbol).toBe('SOL');
        });

        it('should return token info for SPL token', async () => {
            const tokenPublicKey = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
            const mockInstruction = {
                programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
                program: 'spl-token',
                parsed: {
                    info: {
                        mint: tokenPublicKey.toString()
                    }
                }
            } as any;

            const mockTokenInfo: TokenInfo = {
                key: tokenPublicKey.toString(),
                symbol: 'USDC',
                precision: 6
            };

            vi.mocked(mockTokensInfo.getTokenInfo).mockResolvedValue(mockTokenInfo);

            const result = await parser._getTokenInfoFromInstruction(mockInstruction, mockTokensInfo);

            expect(result).not.toBeNull();
            expect(result?.symbol).toBe('USDC');
            expect(result?.key).toBe(tokenPublicKey.toString());
        });

        it('should return default token info for SPL token if cache returns null', async () => {
            const tokenPublicKey = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
            const mockInstruction = {
                programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
                program: 'spl-token',
                parsed: {
                    info: {
                        mint: tokenPublicKey.toString()
                    }
                }
            } as any;

            vi.mocked(mockTokensInfo.getTokenInfo).mockResolvedValue(null);

            const result = await parser._getTokenInfoFromInstruction(mockInstruction, mockTokensInfo);

            expect(result).not.toBeNull();
            expect(result?.key).toBe(tokenPublicKey.toString());
            expect(result?.symbol).toBe(tokenPublicKey.toString());
            expect(result?.precision).toBe(6);
        });

        it('should return null if info is missing for SPL token', async () => {
            const mockInstruction = {
                programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
                program: 'spl-token',
                parsed: null
            } as any;

            const result = await parser._getTokenInfoFromInstruction(mockInstruction, mockTokensInfo);

            expect(result).toBeNull();
        });

        it('should return null for unknown program', async () => {
            const mockInstruction = {
                programId: new PublicKey('11111111111111111111111111111112'),
                parsed: {
                    info: {}
                }
            } as any;

            const result = await parser._getTokenInfoFromInstruction(mockInstruction, mockTokensInfo);

            expect(result).toBeNull();
        });
    });
});

