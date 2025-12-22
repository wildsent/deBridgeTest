import 'dotenv/config';
import { Connection, PublicKey } from "@solana/web3.js";
import { parseDataFromTransaction } from "./scrapper/transaction_parser";
import { DBController } from "./infrastructure/db_controller";
import { TokensInfoCache } from "./infrastructure/tokens_info_cache";
import { fetchOrdersInBatches } from "./scrapper/transaction_getter";
import { OrderInfoResult } from './interfaces/scrapper_interfaces';
import { TokenPriceDownloader } from './infrastructure/token_price_downloader';

const DLN_SRC_PROGRAM_ID = process.env.DLN_SRC_PROGRAM_ID || "";
const DLN_DST_PROGRAM_ID = process.env.DLN_DST_PROGRAM_ID || "";


async function main() {
    const dbController = new DBController();
    await dbController.createTablesIfNotExists();
    await dbController.clearStagingTables();
    const tokenPriceDownloader = new TokenPriceDownloader(dbController);
    const connection = new Connection(process.env.RPC_URL || "https://api.mainnet-beta.solana.com", {
        commitment: "confirmed",
        disableRetryOnRateLimit: false,
        confirmTransactionInitialTimeout: 60000,
    });
    const tokensInfo = new TokensInfoCache(connection);
    for (const programID of [DLN_SRC_PROGRAM_ID, DLN_DST_PROGRAM_ID]) {
        let earliestRecord: OrderInfoResult | null = null;
        if (programID === DLN_SRC_PROGRAM_ID) {
            earliestRecord = await dbController.getEarliestDBRecordFromStaging('CREATED');
        }
        else {
            earliestRecord = await dbController.getEarliestDBRecordFromStaging('FILLED');
        }
        const totalRequired = 25000;
        const generator = fetchOrdersInBatches(connection, new PublicKey(programID), tokensInfo,  totalRequired, 100, earliestRecord?.signature);
        for await (const batch of generator) {
            console.log('Get batch to save to DB');
            await dbController.saveBatchToDB(batch);
            await dbController.convertMainStagingTableToSilver();
        }
    }
    await tokenPriceDownloader.refillTokensPricesTable();
    await dbController.madeViews();
}
main();