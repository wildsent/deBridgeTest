import 'dotenv/config';
import { EventParser, BorshCoder, Event} from "@coral-xyz/anchor";
import { ParsedTransactionWithMeta, PublicKey } from "@solana/web3.js";
import { IDL as DlnSrcIdl } from "../idl/src";
import { IDL as DlnDstIdl } from "../idl/dst";
import { TokensInfoCache } from "../infrastructure/tokens_info_cache";
import type { TransactionParserResult, ParsedOrderCreated, ParsedOrderFilled } from "../interfaces/scrapper_interfaces";
import { OrderCreatedParser } from './order_created_parser';
import { OrderFulfilledParser } from './order_fulfilled_parser';

const DLN_SRC_PROGRAM_ID: string = process.env.DLN_SRC_PROGRAM_ID || "";
const DLN_DST_PROGRAM_ID: string = process.env.DLN_DST_PROGRAM_ID || "";

if (!DLN_SRC_PROGRAM_ID || !DLN_DST_PROGRAM_ID) {
    throw new Error("DLN_SRC_PROGRAM_ID or DLN_DST_PROGRAM_ID is not set");
}

// Parsers for Source and Destination programs
const srcCoder = new BorshCoder(DlnSrcIdl);
const dstCoder = new BorshCoder(DlnDstIdl);
const dstProgramID = new PublicKey(DLN_DST_PROGRAM_ID);
const srcEventParser = new EventParser(new PublicKey(DLN_SRC_PROGRAM_ID), srcCoder);
const dstEventParser = new EventParser(dstProgramID, dstCoder);


export async function parseDataFromTransaction(transaction: ParsedTransactionWithMeta | null, tokensInfo: TokensInfoCache): Promise<TransactionParserResult[] | undefined> {
    if (!transaction) {
        return;
    }
    const logMessages = transaction?.meta?.logMessages || [];
    // Parse events from both programs (convert generator to array)
    const srcEvents = Array.from(srcEventParser.parseLogs(logMessages));
    const dstEvents = Array.from(dstEventParser.parseLogs(logMessages));
    const transactionTimestamp = transaction.blockTime;
    if (transactionTimestamp === undefined || transactionTimestamp === null) {
        return undefined;
    }
    const orderCreatedParser = new OrderCreatedParser();
    const orderCreatedEvent = await orderCreatedParser.parseOrderCreatedEvent(srcEvents, tokensInfo);
    if (orderCreatedEvent !== null) {
        const transactionParserResult: TransactionParserResult[] = [];
        for (const order of orderCreatedEvent) {
            transactionParserResult.push(_collectTransactionParserResult(order, transactionTimestamp));
        }
        return transactionParserResult;
    }
    const orderFulfilledParser = new OrderFulfilledParser(dstProgramID);
    const orderFilledEvent = await orderFulfilledParser.parseOrderFilledEvent(dstEvents, tokensInfo, transaction);
    if (orderFilledEvent !== null) {
        const transactionParserResult: TransactionParserResult[] = [];
        for (const order of orderFilledEvent) {
            transactionParserResult.push(_collectTransactionParserResult(order, transactionTimestamp));
        }
        return transactionParserResult;
    }
}

function _collectTransactionParserResult(order: ParsedOrderCreated | ParsedOrderFilled, transactionTimestamp: number): TransactionParserResult {
    return {
        orderId: order.orderId,
        status: order.status,
        timestamp: transactionTimestamp ?? 0,
        tokenKey: order.tokenKey,
        tokenSymbol: order.tokenSymbol,
        amount: order.amount,
        percentFee: 'percentFee' in order ? order.percentFee : 0,
        fixedFee: 'fixedFee' in order ? order.fixedFee : 0,
    }
}
