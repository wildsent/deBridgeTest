import BN from "bn.js";
import { Event } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { TokensInfoCache } from "../infrastructure/tokens_info_cache";
import { ParsedOrderCreated } from "../interfaces/scrapper_interfaces";
import { TokenInfo } from "../interfaces/infrastructure_interfaces";


export class OrderCreatedParser{
    
    async parseOrderCreatedEvent(trnEvent: Event[], tokensInfo: TokensInfoCache): Promise<ParsedOrderCreated[] | null> {
        // Return information about the "order created" event
        // AAK: I'm not sure if it can be more than one "order created" event in the transaction. Because I couldn't ask the team
        // then decide it will be just one. If not - we need to change the code to choose latest event.
        const idEvent = trnEvent.find(event => event.name === "CreatedOrderId"); 
        if (!idEvent) {
            return null;
        }
        const orderEvent = trnEvent.find(event => event.name === "CreatedOrder");
        if (!orderEvent) {
            return null;
        }
        const orderId = Buffer.from(idEvent.data.orderId as Uint8Array).toString("hex");
        const tokenInfoResult = await this._getTokenInfoFromOrderEvent(orderEvent, tokensInfo);
        let tokenSymbol: string;
        let decimals: number;
        let tokenKey: string;
        
        if (!tokenInfoResult) { // AAK: Not sure what default values should be set here! Temporary set USDC and 6 decimals
            tokenSymbol = 'USDC';
            decimals = 6;
            tokenKey = 'USDC';
        } else {
            tokenSymbol = tokenInfoResult.symbol;
            decimals = tokenInfoResult.precision;
            tokenKey = tokenInfoResult.key;
        }
        const amount = this._getAmountFromOrderEvent(orderEvent, decimals);
        const percentFee = this._getFeeFromOrderEvent(orderEvent, "percentFee", decimals);
        const fixedFee = this._getFeeFromOrderEvent(orderEvent, "fixedFee", decimals);
        return [{
            'orderId': orderId,
            'status': 'created',
            'amount': amount,
            'percentFee': percentFee,
            'fixedFee': fixedFee,
            'tokenSymbol': tokenSymbol,
            'tokenKey': tokenKey
        }];
    }

    _getAmountFromOrderEvent(orderEvent: Event, decimals: number): number {
        const eventData = orderEvent?.data as any;
        const giveAmountRaw = eventData?.order?.give?.amount;
        if (!giveAmountRaw) {
            return 0;
        }
        const giveAmountBigInt = new BN(Buffer.from(giveAmountRaw), 'be').toString();
        const giveAmount = Number(giveAmountBigInt) / 10 ** decimals; 
        return giveAmount;
    }
    
    _getFeeFromOrderEvent(orderEvent: Event, fieldName: string, decimals: number): number {
        const eventData = orderEvent?.data as any;
        const feeRaw = eventData?.[fieldName];
        if (!feeRaw) {
            return 0;
        }
        return Number(feeRaw.toString()) / 10 ** decimals;
    }

    async _getTokenInfoFromOrderEvent(orderEvent: Event, tokensInfo: TokensInfoCache): Promise<TokenInfo | null> {
        const eventData = orderEvent?.data as any;
        const tokenAddressBytes = eventData?.order?.give?.tokenAddress;
        if (!tokenAddressBytes) {
            return null;
        }
        let pubkey: PublicKey | null = null;
        try {
            pubkey = new PublicKey(tokenAddressBytes);
            
        } catch {
             pubkey = new PublicKey(Buffer.from(tokenAddressBytes).toString('hex'));
        
        }
        if (!pubkey) {
            return null;
        }
        return await tokensInfo.getTokenInfo(pubkey);
    }

}