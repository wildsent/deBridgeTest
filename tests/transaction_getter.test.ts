import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Connection, PublicKey, ConfirmedSignatureInfo, VersionedTransactionResponse } from '@solana/web3.js';
import { fetchOrdersInBatches } from '../src/scrapper/transaction_getter';
import { TokensInfoCache } from '../src/infrastructure/tokens_info_cache';
import { parseDataFromTransaction } from '../src/scrapper/transaction_parser';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

vi.mock('../src/scrapper/transaction_parser', () => ({
    parseDataFromTransaction: vi.fn()
}));

// Load test transaction data
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testDataDir = path.join(__dirname, 'tests_data');
const transactionSignatures = [
    "2zhQdZCFiVUxk2wrGE9ukNPtDca9Vy9z1HG6cnYauh4S54mNdBQ7TMSLXasmV5Bv2VbR1QqEY1ewLRf3nCgdLqLc",
    "3qQSDktLZrvPd2QMEkBtxJmpE1jJeHE88Nzws3rgZAmmzTpa46RaWh4bkfXStXDKCprZd8NAYct8qMnBDQn3MC77",
    "5BgLVsmFWafQpNk3TXYUaMNUEQ1JT5JD1Qdv54dnzuV9YhryCMfRob2dG22yUZg7UY4fLZgRNVZsa7rsMEETz8Tz"
];

function loadTransactionFromFile(signature: string): VersionedTransactionResponse | null {
    const filePath = path.join(testDataDir, `tx_${signature}.json`);
    if (!fs.existsSync(filePath)) {
        return null;
    }
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const parsedTransaction = JSON.parse(fileContent);
    return parsedTransaction as VersionedTransactionResponse;
}

describe('transaction_getter', () => {
    let mockConnection: Connection;
    let mockTokensInfo: TokensInfoCache;
    let mockProgramId: PublicKey;

    beforeEach(() => {
        vi.clearAllMocks();
        
        mockConnection = {
            getSignaturesForAddress: vi.fn(),
            getTransaction: vi.fn(),
        } as any;

        mockTokensInfo = {
            getTokenInfo: vi.fn().mockResolvedValue({
                symbol: 'USDC',
                precision: 6
            })
        } as any;

        mockProgramId = new PublicKey('src5qyZHqTqecJV4aY6Cb6zDZLMDzrDKKezs22MPHr4');

        vi.mocked(parseDataFromTransaction).mockImplementation(async (transaction) => {
            if (!transaction) {
                return undefined;
            }
            const sig = (transaction as VersionedTransactionResponse).transaction?.signatures?.[0];
            if (transactionSignatures.includes(sig)) {
                return {
                    orderId: `test_order_id_${sig.slice(0, 8)}`,
                    status: 'created' as const,
                    timestamp: 1766061057,
                    tokenSymbol: 'USDC',
                    amount: 100.0,
                    percentFee: 0.01,
                    fixedFee: 0
                };
            }
            return undefined;
        });
    });

    describe('fetchOrdersInBatches', () => {
        it('should fetch and parse orders from transactions', async () => {
            const signatures: ConfirmedSignatureInfo[] = transactionSignatures.map(sig => ({
                signature: sig,
                slot: 0,
                err: null,
                memo: null,
                blockTime: 1766061057
            }));

            let callCount = 0;
            vi.mocked(mockConnection.getSignaturesForAddress).mockImplementation(async () => {
                callCount++;
                if (callCount > 1) {
                    return [];
                }
                return signatures;
            });
            vi.mocked(mockConnection.getTransaction).mockImplementation(async (sig: string) => {
                return loadTransactionFromFile(sig);
            });

            const totalRequired = 3;
            const batchSize = 10;
            const results: any[] = [];

            for await (const batch of fetchOrdersInBatches(
                mockConnection,
                mockProgramId,
                mockTokensInfo,
                totalRequired,
                batchSize
            )) {
                results.push(...batch);
            }

            expect(mockConnection.getSignaturesForAddress).toHaveBeenCalled();
            expect(mockConnection.getTransaction).toHaveBeenCalledTimes(transactionSignatures.length);
            expect(results.length).toBeGreaterThan(0);
        });

        it('should respect totalRequired limit', async () => {
            const signatures: ConfirmedSignatureInfo[] = [{
                signature: transactionSignatures[0],
                slot: 0,
                err: null,
                memo: null,
                blockTime: 1766061057
            }];

            let callCount = 0;
            vi.mocked(mockConnection.getSignaturesForAddress).mockImplementation(async () => {
                callCount++;
                if (callCount > 1) {
                    return [];
                }
                return signatures;
            });
            vi.mocked(mockConnection.getTransaction).mockImplementation(async (sig: string) => {
                return loadTransactionFromFile(sig);
            });

            const totalRequired = 1;
            const batchSize = 10;
            const results: any[] = [];

            for await (const batch of fetchOrdersInBatches(
                mockConnection,
                mockProgramId,
                mockTokensInfo,
                totalRequired,
                batchSize
            )) {
                results.push(...batch);
            }

            expect(results.length).toBeLessThanOrEqual(totalRequired);
        });

        it('should handle empty signatures list', async () => {
            vi.mocked(mockConnection.getSignaturesForAddress).mockResolvedValue([]);

            const totalRequired = 10;
            const batchSize = 10;
            const results: any[] = [];

            for await (const batch of fetchOrdersInBatches(
                mockConnection,
                mockProgramId,
                mockTokensInfo,
                totalRequired,
                batchSize
            )) {
                results.push(...batch);
            }

            expect(results.length).toBe(0);
            expect(mockConnection.getTransaction).not.toHaveBeenCalled();
        });

        it('should handle null transactions', async () => {
            const signatures: ConfirmedSignatureInfo[] = [{
                signature: 'test_signature',
                slot: 0,
                err: null,
                memo: null,
                blockTime: 1766061057
            }];

            let callCount = 0;
            vi.mocked(mockConnection.getSignaturesForAddress).mockImplementation(async () => {
                callCount++;
                if (callCount > 1) {
                    return [];
                }
                return signatures;
            });
            vi.mocked(mockConnection.getTransaction).mockResolvedValue(null);

            const totalRequired = 10;
            const batchSize = 10;
            const results: any[] = [];

            for await (const batch of fetchOrdersInBatches(
                mockConnection,
                mockProgramId,
                mockTokensInfo,
                totalRequired,
                batchSize
            )) {
                results.push(...batch);
            }

            expect(mockConnection.getTransaction).toHaveBeenCalled();
            expect(results.length).toBe(0);
        });

        it('should use beforeSignature parameter', async () => {
            const signatures: ConfirmedSignatureInfo[] = transactionSignatures.map(sig => ({
                signature: sig,
                slot: 0,
                err: null,
                memo: null,
                blockTime: 1766061057
            }));

            vi.mocked(mockConnection.getSignaturesForAddress).mockResolvedValue(signatures);
            vi.mocked(mockConnection.getTransaction).mockImplementation(async (sig: string) => {
                return loadTransactionFromFile(sig);
            });

            const beforeSignature = transactionSignatures[0];
            const totalRequired = 10;
            const batchSize = 10;

            for await (const batch of fetchOrdersInBatches(
                mockConnection,
                mockProgramId,
                mockTokensInfo,
                totalRequired,
                batchSize,
                beforeSignature
            )) {
                break;
            }

            expect(mockConnection.getSignaturesForAddress).toHaveBeenCalledWith(
                mockProgramId,
                expect.objectContaining({
                    before: beforeSignature
                })
            );
        });

        it('should yield batches when batchSize is reached', async () => {
            const signatures: ConfirmedSignatureInfo[] = transactionSignatures.map(sig => ({
                signature: sig,
                slot: 0,
                err: null,
                memo: null,
                blockTime: 1766061057
            }));

            vi.mocked(mockConnection.getSignaturesForAddress).mockResolvedValue(signatures);
            vi.mocked(mockConnection.getTransaction).mockImplementation(async (sig: string) => {
                return loadTransactionFromFile(sig);
            });

            const totalRequired = 10;
            const batchSize = 2;
            const batches: any[][] = [];

            for await (const batch of fetchOrdersInBatches(
                mockConnection,
                mockProgramId,
                mockTokensInfo,
                totalRequired,
                batchSize
            )) {
                batches.push(batch);
            }

            if (batches.length > 0) {
                expect(batches[0].length).toBeLessThanOrEqual(batchSize);
            }
        });

        it('should handle rate limiting errors with retries', async () => {
            const signatures: ConfirmedSignatureInfo[] = [{
                signature: transactionSignatures[0],
                slot: 0,
                err: null,
                memo: null,
                blockTime: 1766061057
            }];

            let callCount = 0;
            vi.mocked(mockConnection.getSignaturesForAddress).mockResolvedValue(signatures);
            vi.mocked(mockConnection.getTransaction).mockImplementation(async () => {
                callCount++;
                if (callCount === 1) {
                    const error: any = new Error('429 Too Many Requests');
                    error.code = 429;
                    throw error;
                }
                return loadTransactionFromFile(transactionSignatures[0]);
            });

            const totalRequired = 1;
            const batchSize = 10;
            const results: any[] = [];

            for await (const batch of fetchOrdersInBatches(
                mockConnection,
                mockProgramId,
                mockTokensInfo,
                totalRequired,
                batchSize
            )) {
                results.push(...batch);
            }

            expect(callCount).toBeGreaterThan(1);
        });

        it('should skip transactions that return undefined from parser', async () => {
            const signatures: ConfirmedSignatureInfo[] = [{
                signature: transactionSignatures[1],
                slot: 0,
                err: null,
                memo: null,
                blockTime: 1766061057
            }];

            let callCount = 0;
            vi.mocked(mockConnection.getSignaturesForAddress).mockImplementation(async () => {
                callCount++;
                if (callCount > 1) {
                    return [];
                }
                return signatures;
            });
            vi.mocked(mockConnection.getTransaction).mockImplementation(async (sig: string) => {
                return loadTransactionFromFile(sig);
            });
            vi.mocked(parseDataFromTransaction).mockResolvedValue(undefined);

            const totalRequired = 10;
            const batchSize = 10;
            const results: any[] = [];

            for await (const batch of fetchOrdersInBatches(
                mockConnection,
                mockProgramId,
                mockTokensInfo,
                totalRequired,
                batchSize
            )) {
                results.push(...batch);
            }

            expect(results.length).toBe(0);
        });
    });
});

