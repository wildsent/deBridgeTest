import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Connection, PublicKey } from '@solana/web3.js';
import { TokensInfoCache } from '../src/infrastructure/tokens_info_cache';
import { TokenInfo } from '../src/interfaces/infrastructure_interfaces';

// Mock global fetch
global.fetch = vi.fn();

describe('TokensInfoCache', () => {
    let mockConnection: Connection;
    let tokensInfoCache: TokensInfoCache;

    beforeEach(() => {
        vi.clearAllMocks();
        mockConnection = {} as Connection;
    });

    describe('constructor', () => {
        it('should create instance with valid connection', () => {
            tokensInfoCache = new TokensInfoCache(mockConnection);
            expect(tokensInfoCache).toBeInstanceOf(TokensInfoCache);
        });

        it('should throw error if connection is null', () => {
            expect(() => {
                new TokensInfoCache(null as any);
            }).toThrow('Connection is required');
        });

        it('should throw error if connection is undefined', () => {
            expect(() => {
                new TokensInfoCache(undefined as any);
            }).toThrow('Connection is required');
        });
    });

    describe('getTokenInfo', () => {
        beforeEach(() => {
            tokensInfoCache = new TokensInfoCache(mockConnection);
        });

        it('should return cached token info if exists', async () => {
            const tokenPublicKey = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
            const cachedTokenInfo: TokenInfo = {
                key: tokenPublicKey.toString(),
                symbol: 'USDC',
                precision: 6
            };

            // Manually set cache
            (tokensInfoCache as any).tokens.set(tokenPublicKey.toString(), cachedTokenInfo);

            const result = await tokensInfoCache.getTokenInfo(tokenPublicKey);

            expect(result).toEqual(cachedTokenInfo);
            expect(global.fetch).not.toHaveBeenCalled();
        });

        it('should fetch from API if not in cache', async () => {
            const tokenPublicKey = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
            const tokenPublicKeyString = tokenPublicKey.toString();
            const apiResponse = [{
                symbol: 'USDC',
                decimals: 6
            }];

            vi.mocked(global.fetch).mockResolvedValueOnce({
                json: async () => apiResponse
            } as Response);

            const result = await tokensInfoCache.getTokenInfo(tokenPublicKey);

            expect(result).toEqual({
                key: tokenPublicKeyString,
                symbol: 'USDC',
                precision: 6
            });
            expect(global.fetch).toHaveBeenCalled();
        });

        it('should cache token info after fetching from API', async () => {
            const tokenPublicKey = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
            const tokenPublicKeyString = tokenPublicKey.toString();
            const apiResponse = [{
                symbol: 'SOL',
                decimals: 9
            }];

            vi.mocked(global.fetch).mockResolvedValueOnce({
                json: async () => apiResponse
            } as Response);

            // First call - should fetch from API
            const result1 = await tokensInfoCache.getTokenInfo(tokenPublicKey);
            expect(global.fetch).toHaveBeenCalledTimes(1);

            // Second call - should return from cache
            const result2 = await tokensInfoCache.getTokenInfo(tokenPublicKey);
            expect(global.fetch).toHaveBeenCalledTimes(1);
            expect(result1).toEqual(result2);
            expect(result2).toEqual({
                key: tokenPublicKeyString,
                symbol: 'SOL',
                precision: 9
            });
        });

        it('should return default values when API returns empty array', async () => {
            const tokenPublicKey = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
            const tokenPublicKeyString = tokenPublicKey.toString();

            vi.mocked(global.fetch).mockResolvedValueOnce({
                json: async () => []
            } as Response);

            const result = await tokensInfoCache.getTokenInfo(tokenPublicKey);

            expect(result).not.toBeNull();
            expect(result).toEqual({
                key: tokenPublicKeyString,
                symbol: tokenPublicKeyString,
                precision: 6
            });
        });

        it('should handle API errors gracefully', async () => {
            const tokenPublicKey = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

            vi.mocked(global.fetch).mockRejectedValueOnce(new Error('Network error'));

            await expect(tokensInfoCache.getTokenInfo(tokenPublicKey)).rejects.toThrow('Network error');
        });

        it('should use first item from API response array', async () => {
            const tokenPublicKey = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
            const tokenPublicKeyString = tokenPublicKey.toString();
            const apiResponse = [
                {
                    symbol: 'USDC',
                    decimals: 6
                },
                {
                    symbol: 'USDT',
                    decimals: 6
                }
            ];

            vi.mocked(global.fetch).mockResolvedValueOnce({
                json: async () => apiResponse
            } as Response);

            const result = await tokensInfoCache.getTokenInfo(tokenPublicKey);

            expect(result).toEqual({
                key: tokenPublicKeyString,
                symbol: 'USDC',
                precision: 6
            });
        });
    });
});

