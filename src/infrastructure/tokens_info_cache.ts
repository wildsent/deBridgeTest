import { Connection, PublicKey } from "@solana/web3.js";
import { TokenInfo } from "../interfaces/infrastructure_interfaces";

export class TokensInfoCache {
    private tokens: Map<string, TokenInfo> = new Map();
    private connection: Connection;

    constructor(connection: Connection) {
        if (!connection) {
            throw new Error("Connection is required");
        }
        this.connection = connection;
    }
    async getTokenInfo(tokenPublicKey: PublicKey): Promise<TokenInfo | null> {
        // Return token info from cache or API
        const tokenPublicKeyString = tokenPublicKey.toString();
        const cachedTokenInfo = this.tokens.get(tokenPublicKeyString);
        if (cachedTokenInfo) {
            return cachedTokenInfo;
        }
        const tokenInfo = await this._getTokenInfoFromApi(tokenPublicKey);
        if (tokenInfo) {
            this.tokens.set(tokenPublicKeyString, tokenInfo);
            return tokenInfo;
        }
        return null;
    }

    private async _getTokenInfoFromApi(tokenPublicKey: PublicKey): Promise<TokenInfo | undefined> {
        // TO DO: Change when normal API will be working
        const tokenPK = tokenPublicKey.toString();
        const response = await fetch(`https://lite-api.jup.ag/tokens/v2/search?query=${tokenPK}`);
        const data = await response.json() as { symbol: string; decimals: number }[];
        if (data.length > 0) {
            return {
                key: tokenPK,
                symbol: data[0].symbol,
                precision: data[0].decimals
            };
        }
    return { // Default values
        key: tokenPK,
        symbol: tokenPK,
        precision: 6
    };
    }
}

