import 'dotenv/config';
import pLimit from 'p-limit';
import cliProgress from 'cli-progress';
import { ConfirmedSignatureInfo, Connection, ParsedTransactionWithMeta, PublicKey, Transaction, VersionedTransactionResponse } from "@solana/web3.js";
import { parseDataFromTransaction } from "./transaction_parser";
import type { OrderInfoResult } from "../interfaces/scrapper_interfaces";
import { TokensInfoCache } from "../infrastructure/tokens_info_cache";

const MAX_CONCURRENT_REQUESTS = 5; // Because I use free RPC I can make only 10 requests per second.
const SIGNATURES_BATCH_SIZE = 200;

async function _getTransactions(connection: Connection, signaturesList: ConfirmedSignatureInfo[]): Promise<ParsedTransactionWithMeta[]> {
  // Parsed transaction with meta data
  const limiter = pLimit(MAX_CONCURRENT_REQUESTS);
  const bar = new cliProgress.SingleBar({
    format: 'Transactions |{bar}| {percentage}% | {value}/{total} | ETA: {eta}s | {duration}s',
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    hideCursor: true
});
  bar.start(signaturesList.length, 0);
  const tasks = signaturesList.map(signature => {
    return limiter(async () => {
      const maxRetries = 5;
      let retriesCounter = 0;
      while (retriesCounter < maxRetries) {
        try {
          const transaction = await connection.getParsedTransaction(signature.signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" })
          bar.increment()
          return transaction;
        } catch (error: any) {
          if (error.message.includes('429') || error.code === 429) {
            retriesCounter++;
            const delay = 1000 * retriesCounter;
            await new Promise(res => setTimeout(res, delay));
            continue;
          } 
        } finally {
            await new Promise(res => setTimeout(res, 500));
            }
        }
      console.error(`Skipped ${signature.signature} because no more retries`);
      return null;
    });
  });
  const results = await Promise.all(tasks);
  bar.stop();
  return results.filter(result => result !== null) as ParsedTransactionWithMeta[];
}

export async function* fetchOrdersInBatches(
  connection: Connection,
  programId: PublicKey,
  tokensInfo: TokensInfoCache,
  totalRequired: number,
  batchSize: number = 5000,
  beforeSignature: string | undefined = undefined,
): AsyncGenerator<OrderInfoResult[], void, unknown>
{
  // TODO: Add download data till last signature from DB
  let parsedOrders: OrderInfoResult[] = [];
  let lastSignature: string | undefined = beforeSignature;
  let collectedCount = 0;

  while (collectedCount < totalRequired) {
    const signatures = await connection.getSignaturesForAddress(programId, {
      before: lastSignature,
      limit: Math.min(SIGNATURES_BATCH_SIZE, batchSize),
    });
    
    if (signatures.length === 0) break;
    lastSignature = signatures[signatures.length - 1].signature;
    console.log(`Found ${signatures.length} signatures`);

    const transactions = await _getTransactions(connection, signatures);
    console.log(`Found ${transactions.length} transactions`);
    if (!transactions) {
      continue;
    }
    const alreadyParsedOrdersLen = parsedOrders.length; // AAK: Need to count only new parsed orders

    for (const transaction of transactions) { 
      const parsedData = await parseDataFromTransaction(transaction, tokensInfo);
      if (parsedData !== undefined && parsedData.length > 0) {
        for (const order of parsedData) {
          const resultOrder: OrderInfoResult = {
            ...order,
            signature: transaction.transaction.signatures[0],
          };
          parsedOrders.push(resultOrder);
        }
      }
    }
    
    collectedCount += parsedOrders.length - alreadyParsedOrdersLen;
    console.log(`Collected ${collectedCount} orders from ${totalRequired} required`);
    if (parsedOrders.length >= batchSize || collectedCount >= totalRequired) {
      yield parsedOrders.splice(0, batchSize); 
    }}
}
