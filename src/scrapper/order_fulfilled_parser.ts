import { Event} from "@coral-xyz/anchor";
import { CompiledInstruction, ParsedInnerInstruction, ParsedInstruction, ParsedTransactionWithMeta, PublicKey, TransactionResponse } from "@solana/web3.js";
import { TokensInfoCache } from "../infrastructure/tokens_info_cache";
import type { TokenInfo } from "../interfaces/infrastructure_interfaces";
import { ParsedOrderFilled } from "../interfaces/scrapper_interfaces";

export class OrderFulfilledParser{
    private dstProgramID: PublicKey;
    constructor(dstProgramID: PublicKey) {
        this.dstProgramID = dstProgramID;
        if (!this.dstProgramID) {
            throw new Error("DLN_DST_PROGRAM_ID is not set");
        }
    }

    async  parseOrderFilledEvent(dstEvents: Event[], tokensInfo: TokensInfoCache, transaction: ParsedTransactionWithMeta): Promise<ParsedOrderFilled[] | null> {
        const idEvent = dstEvents.filter(event => event.name === "Fulfilled");
        if (!idEvent) {
            return null;
        }
        let fulfilledEventsIDs: string[] = [];
        for (const event of idEvent) {
            const orderId = Buffer.from(event.data.orderId as Uint8Array).toString("hex");
            fulfilledEventsIDs.push(orderId);
        }
        let fulfilledEventsInstIndexes: number[] = this._getFulfilledEventsInstIndexes(transaction, this.dstProgramID, "FulfillOrder");  // We need to get the instruction index of the fulfilled events to get amount information
        if (fulfilledEventsInstIndexes.length !== fulfilledEventsIDs.length) {
            console.error(`${transaction.transaction.signatures[0]}: Fulfilled events inst indexes (${fulfilledEventsInstIndexes.length}) and IDs length (${fulfilledEventsIDs.length}) mismatch`)  ;
            return null;
        }

        let orderFilledEvents: ParsedOrderFilled[] = [];
        for (let i = 0; i < fulfilledEventsIDs.length; i++) {
            const innerTransferInstruction = this._getTransferInnerInstruction(transaction, fulfilledEventsInstIndexes[i]);
            if (!innerTransferInstruction) {
                console.error(`${transaction.transaction.signatures[0]}: Transfer inner instruction not found for order ${fulfilledEventsIDs[i]}`);
                continue;
            }
            const tokenInfoResult = await this._getTokenInfoFromInstruction(innerTransferInstruction, tokensInfo);
            if (!tokenInfoResult) {
                console.error(`${transaction.transaction.signatures[0]}: Token info not found for order ${fulfilledEventsIDs[i]}`);
                continue;
            }
            const tokenSymbol = tokenInfoResult.symbol;
            const tokenKey = tokenInfoResult.key;
            const amount = this._getAmountFromInstruction(innerTransferInstruction, tokenInfoResult);

            orderFilledEvents.push({
                orderId: fulfilledEventsIDs[i],
                amount: amount,
                status: 'filled',
                tokenKey: tokenKey,
                tokenSymbol: tokenSymbol
            });
        }

        return orderFilledEvents;
    }

    _getAmountFromInstruction(innerTransferInstruction: ParsedInstruction, tokenInfoResult: TokenInfo): number {
        const programId = innerTransferInstruction.programId.toString();
        const parsedData = innerTransferInstruction.parsed as any;
        if (!parsedData) {
            return 0;
        }
        if (programId === "11111111111111111111111111111111") {
            return parsedData.info?.lamports / 10 ** tokenInfoResult.precision;
        }
        if (innerTransferInstruction.program.toString() === 'spl-token' || innerTransferInstruction.programId.toString() === "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") {
            return Number(parsedData.info?.amount) || Number(parsedData.info?.tokenAmount?.amount) / 10 ** tokenInfoResult.precision;
        }
        return 0;
    }

    _getTransferInnerInstruction(transaction: ParsedTransactionWithMeta, instIndex: number): ParsedInstruction | null {
        const instruction =  transaction.meta?.innerInstructions?.find(
            inner => inner.index === instIndex
        ) as ParsedInnerInstruction | null;
        if (!instruction) {
            return null;
        }
        const innerInstructions = instruction.instructions as ParsedInstruction[];
        for (const innerInstruction of innerInstructions) {
            if (innerInstruction.parsed?.type === "transfer" || innerInstruction.parsed?.type === "transferChecked") {
                return innerInstruction as ParsedInstruction;
            }
        }
        return null;
    }

    _getFulfilledEventsInstIndexes(transaction: ParsedTransactionWithMeta, programID: PublicKey, eventName: string): number[] {
        const instIndexes: number[] = [];
        let programInvokeCounter = -1;
        let invokeCounter = 0;
        const logMessages = transaction.meta?.logMessages || [];
        const programIDString = programID.toString();
        for (const message of logMessages) {
            if (message.includes(programIDString) && message.includes('invoke [1]')) {
                programInvokeCounter = invokeCounter;
                invokeCounter++;
            } else if (message.includes('invoke [1]')){
                invokeCounter++;
            }
            if (message.includes(eventName) && (programInvokeCounter!== 0)) {
                instIndexes.push(programInvokeCounter);
                programInvokeCounter = -1;
            }
        }
        return instIndexes;
    }

    async _getTokenInfoFromInstruction(instruction: ParsedInstruction, tokensInfoCache: TokensInfoCache): Promise<TokenInfo | null> {
        if (instruction.programId.toString() === "11111111111111111111111111111111") {
            const tokenPublicKey = new PublicKey("So11111111111111111111111111111111111111112");
            let tokenInfo: TokenInfo | null = await tokensInfoCache.getTokenInfo(tokenPublicKey);
            if (!tokenInfo) {
                tokenInfo = {
                    key: tokenPublicKey.toString(),
                    symbol: 'SOL',
                    precision: 9
                };
            }
            return tokenInfo;
        }

        if (instruction.program === 'spl-token') {
            const infoInstr = instruction.parsed?.info as any;
            if (!infoInstr) {
                return null;
            }

            const tokenAddress = infoInstr.mint;
            let tokenInfo: TokenInfo | null = await tokensInfoCache.getTokenInfo(new PublicKey(tokenAddress));
            if (!tokenInfo) { // AAK: Not sure what default values should be set here! Temporary set USDC and 6 decimals
                tokenInfo = {
                    key: tokenAddress,
                    symbol: tokenAddress,
                    precision: 6
                };
            }
            return tokenInfo;
        }
        return null;
    }
}
