import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DBController } from '../src/infrastructure/db_controller';
import { OrderInfoResult } from '../src/interfaces/scrapper_interfaces';

// Mock pg module
const mockClient = {
    query: vi.fn(),
    release: vi.fn(),
};

const mockPoolInstance = {
    connect: vi.fn().mockResolvedValue(mockClient),
    query: vi.fn(),
};

vi.mock('pg', () => {
    class MockPool {
        connect = mockPoolInstance.connect;
        query = mockPoolInstance.query;
    }
    
    return {
        Pool: MockPool,
        Client: vi.fn(),
    };
});

describe('DBController', () => {
    let dbController: DBController;

    beforeEach(() => {
        vi.clearAllMocks();
        mockPoolInstance.connect.mockResolvedValue(mockClient);
        mockClient.query.mockReset();
        mockClient.release.mockReset();
        mockPoolInstance.query.mockReset();
        
        dbController = new DBController();
    });

    describe('constructor', () => {
        it('should create instance with pool', () => {
            expect(dbController).toBeInstanceOf(DBController);
        });
    });

    describe('clearStagingTables', () => {
        it('should clear staging tables successfully', async () => {
            mockClient.query.mockResolvedValue({ rows: [] });

            await dbController.clearStagingTables();

            expect(mockPoolInstance.connect).toHaveBeenCalled();
            expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
            expect(mockClient.query).toHaveBeenCalledWith(
                expect.stringContaining('DELETE FROM staging_orders')
            );
            expect(mockClient.query).toHaveBeenCalledWith(
                expect.stringContaining('DELETE FROM staging_prices')
            );
            expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
            expect(mockClient.release).toHaveBeenCalled();
        });

        it('should rollback on error', async () => {
            const error = new Error('Database error');
            mockClient.query.mockRejectedValueOnce(error);

            await expect(dbController.clearStagingTables()).rejects.toThrow('Database error');

            expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
            expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
            expect(mockClient.release).toHaveBeenCalled();
        });
    });

    describe('saveBatchToDB', () => {
        const mockBatch: OrderInfoResult[] = [
            {
                signature: 'test_signature_1',
                orderId: 'order_1',
                status: 'created',
                timestamp: 1000000,
                tokenKey: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
                tokenSymbol: 'USDC',
                amount: 100.5,
                percentFee: 0.01,
                fixedFee: 0.5
            },
            {
                signature: 'test_signature_2',
                orderId: 'order_2',
                status: 'filled',
                timestamp: 1000001,
                tokenKey: 'So11111111111111111111111111111111111111112',
                tokenSymbol: 'SOL',
                amount: 50.25,
                percentFee: 0.02,
                fixedFee: 0.1
            }
        ];

        it('should save batch successfully', async () => {
            mockClient.query.mockResolvedValue({ rows: [] });

            await dbController.saveBatchToDB(mockBatch);

            expect(mockPoolInstance.connect).toHaveBeenCalled();
            expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
            expect(mockClient.query).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO staging_orders'),
                expect.arrayContaining([
                    expect.arrayContaining(['test_signature_1', 'test_signature_2']),
                    expect.arrayContaining(['order_1', 'order_2']),
                    expect.arrayContaining(['CREATED', 'FILLED']),
                    expect.arrayContaining(['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'So11111111111111111111111111111111111111112']),
                    expect.arrayContaining(['USDC', 'SOL']),
                    expect.arrayContaining([100.5, 50.25]),
                    expect.arrayContaining([0.01, 0.02]),
                    expect.arrayContaining([0.5, 0.1]),
                    expect.any(Array)
                ])
            );
            expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
            expect(mockClient.release).toHaveBeenCalled();
        });

        it('should throw error if amount exceeds MAX_DECIMAL_VALUE', async () => {
            const largeBatch: OrderInfoResult[] = [{
                ...mockBatch[0],
                amount: 10 ** 21
            }];

            await expect(dbController.saveBatchToDB(largeBatch)).rejects.toThrow();
        });

        it('should rollback on database error', async () => {
            const error = new Error('Database error');
            mockClient.query.mockRejectedValueOnce(error);

            await expect(dbController.saveBatchToDB(mockBatch)).rejects.toThrow('Database error');

            expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
            expect(mockClient.release).toHaveBeenCalled();
        });

        it('should handle decimal overflow error code', async () => {
            const error: any = new Error('Decimal overflow');
            error.code = '22003';
            mockClient.query.mockRejectedValueOnce(error);

            await expect(dbController.saveBatchToDB(mockBatch)).rejects.toThrow();

            expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
        });
    });

    describe('getLastDBRecord', () => {
        it('should return last record from staging', async () => {
            const mockRecord: OrderInfoResult = {
                signature: 'test_signature',
                orderId: 'order_1',
                status: 'created',
                timestamp: 1000000,
                tokenKey: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
                tokenSymbol: 'USDC',
                amount: 100.5,
                percentFee: 0.01,
                fixedFee: 0.5
            };

            mockPoolInstance.query.mockResolvedValue({ rows: [mockRecord] });

            const result = await dbController.getLastDBRecord();

            expect(result).toEqual(mockRecord);
            expect(mockPoolInstance.query).toHaveBeenCalledWith(
                expect.stringContaining('SELECT * FROM staging_orders ORDER BY timestamp DESC LIMIT 1')
            );
        });

        it('should return null if no records found', async () => {
            mockPoolInstance.query.mockResolvedValue({ rows: [] });

            const result = await dbController.getLastDBRecord();

            // When rows[0] doesn't exist, it returns undefined
            expect(result).toBeUndefined();
        });
    });

    describe('getEarliestDBRecordFromStaging', () => {
        it('should return earliest record without status filter', async () => {
            const mockRecord: OrderInfoResult = {
                signature: 'test_signature',
                orderId: 'order_1',
                status: 'created',
                timestamp: 1000000,
                tokenKey: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
                tokenSymbol: 'USDC',
                amount: 100.5,
                percentFee: 0.01,
                fixedFee: 0.5
            };

            mockClient.query.mockResolvedValue({ rows: [mockRecord] });

            const result = await dbController.getEarliestDBRecordFromStaging();

            expect(result).toEqual(mockRecord);
            expect(mockPoolInstance.connect).toHaveBeenCalled();
            expect(mockClient.query).toHaveBeenCalledWith(
                expect.stringContaining('SELECT * FROM staging_orders ORDER BY timestamp ASC LIMIT 1')
            );
            expect(mockClient.release).toHaveBeenCalled();
        });

        it('should return earliest record with status filter', async () => {
            const mockRecord: OrderInfoResult = {
                signature: 'test_signature',
                orderId: 'order_1',
                status: 'created',
                timestamp: 1000000,
                tokenKey: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
                tokenSymbol: 'USDC',
                amount: 100.5,
                percentFee: 0.01,
                fixedFee: 0.5
            };

            mockClient.query.mockResolvedValue({ rows: [mockRecord] });

            const result = await dbController.getEarliestDBRecordFromStaging('CREATED');

            expect(result).toEqual(mockRecord);
            expect(mockClient.query).toHaveBeenCalledWith(
                expect.stringContaining('SELECT * FROM staging_orders WHERE status = $1'),
                ['CREATED']
            );
            expect(mockClient.release).toHaveBeenCalled();
        });

        it('should return null if no records found', async () => {
            mockClient.query.mockResolvedValue({ rows: [] });

            const result = await dbController.getEarliestDBRecordFromStaging();

            // When rows[0] doesn't exist, it returns undefined
            expect(result).toBeUndefined();
            expect(mockClient.release).toHaveBeenCalled();
        });
    });

    describe('convertMainStagingTableToSilver', () => {
        it('should convert staging to silver successfully', async () => {
            mockClient.query.mockResolvedValue({ rows: [] });

            await dbController.convertMainStagingTableToSilver();

            expect(mockPoolInstance.connect).toHaveBeenCalled();
            expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
            expect(mockClient.query).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO silver_tokens')
            );
            expect(mockClient.query).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO silver_order_status')
            );
            expect(mockClient.query).toHaveBeenCalledWith(
                expect.stringContaining('WITH moved_orders AS')
            );
            expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
            expect(mockClient.release).toHaveBeenCalled();
        });

        it('should rollback on error', async () => {
            const error = new Error('Database error');
            mockClient.query.mockRejectedValueOnce(error);

            await expect(dbController.convertMainStagingTableToSilver()).rejects.toThrow('Database error');

            expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
            expect(mockClient.release).toHaveBeenCalled();
        });
    });

    describe('saveTokenPricesToDB', () => {
        const mockTokenPrices: Array<[string, string, number, Date, Date]> = [
            ['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'USDC', 1.0, new Date('2024-01-01'), new Date('2024-01-02')],
            ['So11111111111111111111111111111111111111112', 'SOL', 100.5, new Date('2024-01-01'), new Date('2024-01-02')]
        ];

        it('should save token prices successfully', async () => {
            mockClient.query.mockResolvedValue({ rows: [] });

            await dbController.saveTokenPricesToDB(mockTokenPrices);

            expect(mockPoolInstance.connect).toHaveBeenCalled();
            expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
            expect(mockClient.query).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO staging_prices'),
                expect.arrayContaining([
                    expect.arrayContaining(['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'So11111111111111111111111111111111111111112']),
                    expect.arrayContaining(['USDC', 'SOL']),
                    expect.arrayContaining([1.0, 100.5]),
                    expect.any(Array),
                    expect.any(Array)
                ])
            );
            expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
            expect(mockClient.release).toHaveBeenCalled();
        });

        it('should rollback on error', async () => {
            const error = new Error('Database error');
            mockClient.query.mockRejectedValueOnce(error);

            await expect(dbController.saveTokenPricesToDB(mockTokenPrices)).rejects.toThrow('Database error');

            expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
            expect(mockClient.release).toHaveBeenCalled();
        });
    });

    describe('convertStagingPricesToSilver', () => {
        it('should convert staging prices to silver successfully', async () => {
            mockClient.query.mockResolvedValue({ rows: [] });

            await dbController.convertStagingPricesToSilver();

            expect(mockPoolInstance.connect).toHaveBeenCalled();
            expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
            expect(mockClient.query).toHaveBeenCalledWith(
                expect.stringContaining('WITH moved_prices AS')
            );
            expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
            expect(mockClient.release).toHaveBeenCalled();
        });

        it('should rollback on error', async () => {
            const error = new Error('Database error');
            mockClient.query.mockRejectedValueOnce(error);

            await expect(dbController.convertStagingPricesToSilver()).rejects.toThrow('Database error');

            expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
            expect(mockClient.release).toHaveBeenCalled();
        });
    });

    describe('madeViews', () => {
        it('should create views successfully', async () => {
            mockClient.query.mockResolvedValue({ rows: [] });

            await dbController.madeViews();

            expect(mockPoolInstance.connect).toHaveBeenCalled();
            expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
            expect(mockClient.query).toHaveBeenCalledWith(
                expect.stringContaining('CREATE OR REPLACE VIEW gold_orders_view')
            );
            expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
            expect(mockClient.release).toHaveBeenCalled();
        });

        it('should rollback on error', async () => {
            const error = new Error('Database error');
            mockClient.query.mockRejectedValueOnce(error);

            await expect(dbController.madeViews()).rejects.toThrow('Database error');

            expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
            expect(mockClient.release).toHaveBeenCalled();
        });
    });

    describe('getTokenTimeListNotInPriceTable', () => {
        it('should return token time list', async () => {
            const mockResult = [
                {
                    token_key: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
                    token_symbol: 'USDC',
                    min_time: new Date('2024-01-01'),
                    max_time: new Date('2024-01-02')
                }
            ];

            mockClient.query.mockResolvedValue({ rows: mockResult });

            const result = await dbController.getTokenTimeListNotInPriceTable();

            expect(result).toEqual(mockResult);
            expect(mockPoolInstance.connect).toHaveBeenCalled();
            expect(mockClient.query).toHaveBeenCalledWith(
                expect.stringContaining('WITH token_time AS')
            );
            expect(mockClient.release).toHaveBeenCalled();
        });

        it('should return empty array if no tokens found', async () => {
            mockClient.query.mockResolvedValue({ rows: [] });

            const result = await dbController.getTokenTimeListNotInPriceTable();

            expect(result).toEqual([]);
        });
    });
});

