import 'dotenv/config';
import * as fs from 'fs';
import { DBController } from "./db_controller";
import { request } from 'http';
import cliProgress from 'cli-progress';

export class TokenPriceDownloader {
    private _dbController: DBController;
    private _dictOfTokensID: Record<string, string>;
    private _apiKey: string[];
    
    constructor(dbController: DBController) {
        this._dbController = dbController;
        this._dictOfTokensID = {};
        const apiKeyEnv = process.env.PRICE_API_KEY;
        if (!apiKeyEnv) {
            throw new Error('PRICE_API_KEY is not set');
        }
        if (apiKeyEnv.includes(',')) {
            this._apiKey = apiKeyEnv.split(',');
        }
        else {
            this._apiKey = [apiKeyEnv];
        }
    }

    async refillTokensPricesTable(): Promise<void> {
        if (Object.keys(this._dictOfTokensID).length === 0) {
            await this._initDictOfTokensID();
        }
        const tokenTimeList = await this._dbController.getTokenTimeListNotInPriceTable();
        let totalTokensSaved = 0;
        for await (const tokenPriceIntervals of this._fetchTokenPriceIntervals(tokenTimeList, 100)) {
            await this._dbController.saveTokenPricesToDB(tokenPriceIntervals);
            totalTokensSaved += tokenPriceIntervals.length;
            console.log(`Saved ${totalTokensSaved} tokens of ${tokenTimeList.length}`);
        }
        await this._dbController.convertStagingPricesToSilver();
        console.log('Tokens prices table refilled');
    }
    
    private async* _fetchTokenPriceIntervals(
        tokenTimeList: Array<{token_key: string, token_symbol: string, min_time: Date, max_time: Date}>,
        batchSize: number
    ): AsyncGenerator<Array<[string, string, number, Date, Date]>> {
        const now = new Date();
        let tokenPriceIntervals: Array<[string, string, number, Date, Date]> = [];
        let tokenIgnoredList: Array<[string, string, Date, Date]> = [];
        const bar = new cliProgress.SingleBar({
            format: 'Fetching token price intervals |{bar}| {percentage}% | {value}/{total} | ETA: {eta}s | {duration}s',
            barCompleteChar: '\u2588',
            barIncompleteChar: '\u2591',
            hideCursor: true
        });
        bar.start(tokenTimeList.length, 0);
        for (const token of tokenTimeList) {
            let tokenCounter = 0;
            const tokenID = this._dictOfTokensID[token.token_key];
            if (!tokenID) {
                console.warn(`Token not found in dict of tokens ID: ${token.token_key}`);
                tokenIgnoredList.push([token.token_key, token.token_symbol, token.min_time, token.max_time]);
                continue;
                bar.increment();
            }
            await new Promise(res => setTimeout(res, 1000));
            const minTime = new Date(token.min_time);
            const daysDiff = Math.ceil((now.getTime() - minTime.getTime()) / (1000 * 60 * 60 * 24));

            const priceData = await this._fetchPriceData(tokenID, daysDiff);
            if (!priceData) {
                console.warn(`Failed to fetch price data for token ${token.token_key}`);
                continue;
                bar.increment();
            }
            const normalizedPrices = this._normalizePricesToDaily(priceData.prices);
            const filteredPrices = this._filterPricesByTimeRange(normalizedPrices, token.min_time, token.max_time);
            const priceIntervals = this._createPriceIntervals(token.token_key, token.token_symbol, filteredPrices);
            tokenPriceIntervals.push(...priceIntervals);
            bar.increment();
            tokenCounter++;
            if (tokenCounter >= batchSize) {
                yield tokenPriceIntervals;
                tokenPriceIntervals = [];
                tokenCounter = 0;
            }
        }
        bar.stop();
        for (const token of tokenIgnoredList) {
            const priceIntervalsIgnoredList = this._createPriceIntervalsIgnoredList(token[0], token[1], token[2], token[3]);
            tokenPriceIntervals.push(...priceIntervalsIgnoredList);
        }
        
        yield tokenPriceIntervals;
}

    private _createPriceIntervalsIgnoredList(
        tokenKey: string,
        tokenSymbol: string,
        minTime: Date | string,
        maxTime: Date | string
    ): Array<[string, string, number, Date, Date]> {
        // AAK: Because coingecko don't know this token, we fill the price by 0.
        // TODO: We need to get the price from the other source (DEX aggregator ?).
        
        const minDate = new Date(minTime);
        minDate.setHours(0, 0, 0, 0);
        
        const maxDate = new Date(maxTime);
        maxDate.setHours(0, 0, 0, 0);
        
        const intervals: Array<[string, string, number, Date, Date]> = [];
        const currentDate = new Date(minDate);
        // AAK: Interval with 1 day step
        while (currentDate <= maxDate) {
            const timeFrom = new Date(currentDate);
            const timeTill = new Date(currentDate);
            timeTill.setDate(timeTill.getDate() + 1); 
            intervals.push([tokenKey, tokenSymbol, 0, timeFrom, timeTill]);
            currentDate.setDate(currentDate.getDate() + 1);
        }
        return intervals;
    }
 
    private _normalizePricesToDaily(prices: number[][]): number[][] {
        // AAK: Because coingecko returns some data twice for the same day, we need to normalize it to daily prices
        const dailyPricesMap = new Map<number, number[]>();
        for (const [timestamp, price] of prices) {
            const date = new Date(timestamp);
            date.setHours(0, 0, 0, 0);
            const dayStartTimestamp = date.getTime();
            dailyPricesMap.set(dayStartTimestamp, [dayStartTimestamp, price]);
        }
        return Array.from(dailyPricesMap.values()).sort((a, b) => a[0] - b[0]);
    }

    private async _fetchPriceData(tokenId: string, days: number, retryCount: number = 0): Promise<{prices: number[][]} | null> {
        const url = `https://api.coingecko.com/api/v3/coins/${tokenId}/market_chart?vs_currency=usd&days=${days}&interval=daily`;
        const request = new Request(url, {
            headers: {
                'x-cg-demo-api-key': this._apiKey[retryCount % this._apiKey.length]
            }
        });
        const response = await fetch(request);
        if (!response.ok) {
            const errorText = await response.text();
            if (retryCount > 3) {
                return null;
            }
            if (response.status === 429 || errorText.includes('Throttled'))  {
                console.warn(`Rate limit exceeded ${errorText}`);
                await new Promise(res => setTimeout(res, 10000));
                return this._fetchPriceData(tokenId, days, retryCount + 1);
            }
            throw new Error(`Error fetching price data for token ${tokenId}: ${errorText}`);
        }
        return await response.json() as {prices: number[][]};
    }
    
    private _filterPricesByTimeRange(
        prices: number[][],
        minTime: Date,
        maxTime: Date
    ): number[][] {
        const minTimestamp = minTime.getTime();
        const maxDate = new Date(maxTime);
        maxDate.setDate(maxDate.getDate() + 1);
        const maxTimestamp = maxDate.getTime();
        return prices.filter(([timestamp]) => {
            return timestamp >= minTimestamp && timestamp <= maxTimestamp;
        });
    }
    
    private _createPriceIntervals(
        tokenKey: string,
        tokenSymbol: string,
        filteredPrices: number[][]
    ): Array<[string, string, number, Date, Date]> {
        return filteredPrices.map(([timestamp, price]) => {
            const timeFrom = new Date(timestamp);
            const timeTill = new Date(timeFrom);
            timeTill.setDate(timeTill.getDate() + 1); // Increase to 1 day
            return [tokenKey, tokenSymbol, price, timeFrom, timeTill];
        });
    }

    async _initDictOfTokensID(): Promise<void> {
        const request = new Request('https://api.coingecko.com/api/v3/coins/list?include_platform=true', {
            headers: {
                'x-cg-demo-api-key': this._apiKey
            }
        });
        const response = await fetch(request);
        
        const data = await response.json() as { id: string, symbol: string, platforms: { solana?: string } }[];
        // console.log(data);
        for (const token of data) {
            if (!token.platforms) {
                continue;
            }
            for (const platform of Object.values(token.platforms)) {
                const key = platform.toString();
                this._dictOfTokensID[key] = token.id;
            }
        }
        console.log('Dict of tokens ID initialized with length: ', Object.keys(this._dictOfTokensID).length);
    }
}