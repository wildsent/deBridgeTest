import { Connection } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';

const transactionSignatures = [
    "5WKRcPxTFsFefeCKG4hzeNy2Wa72STG8xUH2bSUa8yV3FSmHmap2hv1jxpgVMc7Gq9mkZ1RnpYB2wUVJQx5Mf48H",
    // "TKY49Kw2QRZnw7hiTZEqDTD9d2YLUsXA6Qt5oCdknhxn9Q5myCehzV24Z6WpBdWaQcKNvLMqpqbyMqjaqjWkRV8"
];
const connection = new Connection("https://api.mainnet-beta.solana.com");
for (const signature of transactionSignatures) {
    const transaction = await connection.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' });
    if (!transaction) {
        console.log(`Transaction ${signature} not found`);
        continue;
    }
    fs.writeFileSync(
        `/Users/noutia/Codes/debridge_pars/tests/tests_data/tx_${signature}.json`, 
        JSON.stringify(transaction, null, 2)
    );
    console.log(`Transaction ${signature} saved`);
    await new Promise(resolve => setTimeout(resolve, 5000));

}
