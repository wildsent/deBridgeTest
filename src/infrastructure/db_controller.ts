import { Pool, Client } from 'pg';
import { OrderInfoResult } from '../interfaces/scrapper_interfaces';


export class DBController {
    private pool: Pool;

    constructor() {
        this.pool = new Pool({
            connectionString: process.env.DATABASE_URL,
        });
    }

    async createTablesIfNotExists(): Promise<void>{
        await this._createStagingTables();
        await this._createSilverTables();
        await this._createGoldTables();
        console.log('Tables created successfully');
    }

    private async _createStagingTables(): Promise<void>{
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS staging_orders (
                id SERIAL PRIMARY KEY,
                signature VARCHAR(255) NOT NULL UNIQUE,
                order_id VARCHAR(255) NOT NULL,
                status VARCHAR(10) NOT NULL,
                token_key VARCHAR(255) NOT NULL,
                token_symbol VARCHAR(255) NOT NULL,
                amount DECIMAL(28, 8) NOT NULL,
                percent_fee DECIMAL(18, 8) NOT NULL,
                fixed_fee DECIMAL(18, 8) NOT NULL,
                timestamp TIMESTAMP NOT NULL,
                add_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                is_processed BOOLEAN NOT NULL DEFAULT FALSE,
            CONSTRAINT amount_less_or_equal_to_zero CHECK (amount > 0),
            CONSTRAINT percent_fee_less_then_zero CHECK (percent_fee >= 0),
            CONSTRAINT fixed_fee_less_then_zero CHECK (fixed_fee >= 0),
            CONSTRAINT timestamp_less_or_equal_to_zero CHECK (timestamp > '2015-01-01'::timestamp)
            );
        `)
        // Table for symbol prices
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS staging_prices (
                id SERIAL PRIMARY KEY,
                token_key VARCHAR(255) NOT NULL,
                token_symbol VARCHAR(255) NOT NULL,
                price_usd DECIMAL(38, 18) NOT NULL,
                from_time TIMESTAMP NOT NULL,
                till_time TIMESTAMP NOT NULL,
                add_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                is_processed BOOLEAN NOT NULL DEFAULT FALSE
            );
        `);
        
        await this.pool.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS idx_staging_prices_token_from_time 
            ON staging_prices (token_key, from_time);
        `);

        console.log('Staging tables created');
    }
    
    private async _createSilverTables(): Promise<void>{
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS silver_tokens (
                id SERIAL PRIMARY KEY,
                token_key VARCHAR(255) NOT NULL UNIQUE,
                token_symbol VARCHAR(255) NOT NULL UNIQUE,
                add_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
        `);
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS silver_order_status (
                id SERIAL PRIMARY KEY,
                status VARCHAR(10) NOT NULL UNIQUE
            );
        `);
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS silver_orders (
                id SERIAL PRIMARY KEY,
                signature VARCHAR(255) NOT NULL UNIQUE,
                order_id VARCHAR(255) NOT NULL,
                amount DECIMAL(28, 8) NOT NULL,
                percent_fee DECIMAL(18, 8) NOT NULL,
                fixed_fee DECIMAL(18, 8) NOT NULL,
                token_id INTEGER NOT NULL,
                status_id INTEGER NOT NULL,
                timestamp TIMESTAMP NOT NULL,
                add_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (token_id) REFERENCES silver_tokens (id),
                FOREIGN KEY (status_id) REFERENCES silver_order_status (id)
            );
        `);

        // Table for prices
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS silver_prices (
                id SERIAL PRIMARY KEY,
                token_id INTEGER NOT NULL,
                price_usd DECIMAL(38, 18) NOT NULL,
                from_time TIMESTAMP NOT NULL,
                till_time TIMESTAMP NOT NULL,
                add_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (token_id) REFERENCES silver_tokens (id)
            );
        `);

        await this.pool.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS idx_silver_prices_token_from_time 
            ON silver_prices (token_id, from_time);
        `);
        console.log('Silver table created');
    }

    private async _createGoldTables(): Promise<void>{
        // TODO: Add gold layer tables if needed
        // AAK: Use views instead of tables
        return;
    }
    
    async clearStagingTables(): Promise<void>{
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(`
                DELETE FROM staging_orders
                WHERE is_processed = TRUE and add_at < NOW() - INTERVAL '3 day';
            `);
            await client.query(`
                DELETE FROM staging_prices
                WHERE is_processed = TRUE and add_at < NOW() - INTERVAL '3 day';
            `);
            await client.query('COMMIT');
        }
        catch (e: any) {
            await client.query('ROLLBACK');
            console.error('Error clearing staging tables:', e);
            throw e;
        } finally {
            client.release();
        }
    }

    async saveBatchToDB(batch: OrderInfoResult[]): Promise<void>{
        const MAX_DECIMAL_VALUE = 10 ** 20 - 10 ** -8;
        const client = await this.pool.connect();
        const signatures = batch.map(e => e.signature);
        const ordersIds = batch.map(e => e.orderId);
        const statuses = batch.map(e => e.status.toUpperCase());
        const amounts = batch.map(e => {
            const amount = e.amount;
            if (amount > MAX_DECIMAL_VALUE) {
                throw new Error(`Amount ${amount} is greater than MAX_DECIMAL_VALUE ${MAX_DECIMAL_VALUE} for symbol ${e.tokenSymbol} and signature ${e.signature}`);
            }
            return amount;
        });
        const tokenKeys = batch.map(e => e.tokenKey);
        const tokenSymbols = batch.map(e => e.tokenSymbol.toUpperCase());
        const timestamps = batch.map(e => new Date(e.timestamp * 1000));
        const percentFees = batch.map(e => e.percentFee);
        const fixedFees = batch.map(e => e.fixedFee);

      
        const query = `
          INSERT INTO staging_orders (
            signature, order_id, status, token_key, token_symbol, amount, percent_fee, fixed_fee, timestamp
          ) 
          SELECT * FROM UNNEST($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::numeric[], $7::numeric[], $8::numeric[], $9::timestamptz[])
          ON CONFLICT (signature) DO NOTHING;
        `;
      
        try {
          await client.query('BEGIN');
          await client.query(query, [signatures, ordersIds, statuses, tokenKeys, tokenSymbols, amounts, percentFees, fixedFees, timestamps]);
          await client.query('COMMIT');
          console.log(`Successfully saved ${batch.length} records to Staging`);
        } 
        catch (e: any) {
          await client.query('ROLLBACK');
          console.error('Error saving batch:', e);
          
          if (e.code === '22003') {
            console.error('Decimal overflow detected. Checking values:');
            batch.forEach((item, index) => {
            console.error(`Item ${index}: amount=${item.amount}, percentFee=${item.percentFee}, fixedFee=${item.fixedFee}, tokenSymbol=${item.tokenSymbol}, signature=${item.signature}`);
            });
          }
          throw e;
        }
        finally {
          client.release();
        }
      }

    async getLastDBRecord(): Promise<OrderInfoResult | null>{
        // Return latest record from staging table
        const result = await this.pool.query(`
            SELECT * FROM staging_orders ORDER BY timestamp DESC LIMIT 1;
        `);
        return result.rows[0] as OrderInfoResult | null;
    }

    public async getEarliestDBRecordFromStaging(orderStatus?: string): Promise<OrderInfoResult | null>{
        const client = await this.pool.connect();
        if (orderStatus) {
            const result = await client.query(`
                SELECT * FROM staging_orders WHERE status = $1 ORDER BY timestamp ASC LIMIT 1;
            `, [orderStatus]);
            client.release();
            return result.rows[0] as OrderInfoResult | null;
        }
        const result = await client.query(`
            SELECT * FROM staging_orders ORDER BY timestamp ASC LIMIT 1;
        `);
        client.release();
        return result.rows[0] as OrderInfoResult | null;
    }

   async convertMainStagingTableToSilver(): Promise<void>{
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const updateSilverTokensQuery = `
                INSERT INTO silver_tokens (token_key, token_symbol) SELECT DISTINCT token_key, token_symbol FROM staging_orders WHERE is_processed = FALSE
                ON CONFLICT (token_key) DO NOTHING;
            `;
            const updateSilverOrderStatusQuery = `
                INSERT INTO silver_order_status (status) SELECT DISTINCT status FROM staging_orders WHERE is_processed = FALSE
                ON CONFLICT (status) DO NOTHING;
            `;
            await client.query(updateSilverTokensQuery);
            await client.query(updateSilverOrderStatusQuery);
            await client.query(`
                WITH moved_orders AS (
                    UPDATE staging_orders SET is_processed = TRUE
                    WHERE is_processed = FALSE
                    RETURNING *
                )
                INSERT INTO silver_orders (signature, order_id, token_id, amount, percent_fee, fixed_fee, status_id, timestamp)
                SELECT mo.signature, mo.order_id, tk.id, mo.amount, mo.percent_fee, mo.fixed_fee, st.id, mo.timestamp
                FROM moved_orders mo
                JOIN silver_tokens tk ON mo.token_key = tk.token_key
                JOIN silver_order_status st ON mo.status = st.status
                ON CONFLICT (signature) DO NOTHING;
            `);
            await client.query('COMMIT');
        } catch (e: any) {
            await client.query('ROLLBACK');
            console.error('Error converting main staging table to silver:', e);
            throw e;
        } finally {
            client.release();
        }
    }

    async getTokenTimeListNotInPriceTable(): Promise<{token_key: string, token_symbol: string, min_time: Date, max_time: Date}[]> {
        const client = await this.pool.connect();
        const result = await client.query(`
            WITH token_time AS (
                SELECT so.token_id, MIN(DATE_TRUNC('day', so.timestamp)) AS min_time, MAX(DATE_TRUNC('day', so.timestamp)) AS max_time
                FROM silver_orders so
                GROUP BY so.token_id
            ),
            token_price_info AS (
                SELECT p.token_id, MIN(DATE_TRUNC('day', p.from_time)) AS min_time, MAX(DATE_TRUNC('day', p.till_time)) AS max_time
                FROM silver_prices p
                GROUP BY p.token_id
            )
            SELECT tk.token_key, tk.token_symbol,
            CASE WHEN tpi.min_time IS NULL or tt.min_time < tpi.min_time THEN tt.min_time
                ELSE tpi.max_time END as min_time, 
            CASE WHEN tpi.min_time IS NULL THEN tt.max_time 
                 WHEN tt.max_time > tpi.max_time THEN tt.max_time
                 ELSE tpi.max_time END as max_time
            FROM token_time tt
            LEFT JOIN token_price_info tpi ON tt.token_id = tpi.token_id
            JOIN silver_tokens tk ON tt.token_id = tk.id
            WHERE tpi.min_time IS NULL or tt.min_time < tpi.min_time or tt.max_time > tpi.max_time
            ORDER BY tk.token_key;
        `);
        client.release();
        return result.rows as {token_key: string, token_symbol: string, min_time: Date, max_time: Date}[];
    }
    async saveTokenPricesToDB(tokenPrices: Array<[string, string, number, Date, Date]>): Promise<void> {
        const client = await this.pool.connect();
        const tokenKeys: string[] = [];
        const tokenSymbols: string[] = [];
        const prices: number[] = [];
        const fromTimes: Date[] = [];
        const tillTimes: Date[] = [];
        
        for (const [tokenKey, tokenSymbol, price, fromTime, tillTime] of tokenPrices) {
            tokenKeys.push(tokenKey);
            tokenSymbols.push(tokenSymbol);
            prices.push(price);
            fromTimes.push(fromTime);
            tillTimes.push(tillTime);
        }
        try {
            await client.query('BEGIN');
            const query = `
            INSERT INTO staging_prices (token_key, token_symbol, price_usd, from_time, till_time)
            SELECT * FROM UNNEST($1::text[], $2::text[], $3::numeric[], $4::timestamptz[], $5::timestamptz[])
            ON CONFLICT (token_key, from_time) DO NOTHING;
        `;
            await client.query(query, [tokenKeys, tokenSymbols, prices, fromTimes, tillTimes]);
            await client.query('COMMIT');
        } catch (e: any) {
            await client.query('ROLLBACK');
            console.error('Error saving token prices to DB:', e);
            throw e;
        } finally {
            client.release();
        }
    }
    async convertStagingPricesToSilver(): Promise<void> {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const query = (`
            WITH moved_prices AS (
                UPDATE staging_prices SET is_processed = TRUE
                WHERE is_processed = FALSE
                RETURNING *
            )
            INSERT INTO silver_prices (token_id, price_usd, from_time, till_time)
            SELECT tk.id, mp.price_usd, mp.from_time, mp.till_time
            FROM moved_prices mp
            JOIN silver_tokens tk ON mp.token_key = tk.token_key
            ON CONFLICT (token_id, from_time) DO NOTHING;
            `);
            await client.query(query);
            await client.query('COMMIT');
        }
        catch (e: any) {
            await client.query('ROLLBACK');
            console.error('Error converting staging prices to silver:', e);
            throw e;
        } finally {
            client.release();
        }
    }
    async madeViews(): Promise<void> {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(`
                CREATE OR REPLACE VIEW gold_orders_view AS
                WITH orders_agg_by_hour AS (
                    SELECT DATE_TRUNC('hour', so.timestamp) AS hour, so.token_id, so.status_id,
                        SUM(so.amount * sp.price_usd) AS amount_usd,
                        SUM(so.percent_fee * sp.price_usd) AS percent_fee_usd, SUM(so.fixed_fee * sp.price_usd) AS fixed_fee_usd,
                        SUM((so.amount + so.percent_fee + so.fixed_fee) * sp.price_usd) AS total_amount_usd,
                        COUNT(*) as num_of_orders
                    FROM silver_orders so
                    INNER JOIN silver_prices sp ON so.token_id = sp.token_id
                    WHERE DATE_TRUNC('hour', so.timestamp) >= sp.from_time AND DATE_TRUNC('hour', so.timestamp) < sp.till_time 
                    GROUP BY so.token_id, so.status_id, DATE_TRUNC('hour', so.timestamp)
                )
                -- SELECT oah.hour as "Time", st.status as "Status", tk.token_symbol, oah.amount_usd as "Amount USD", oah.percent_fee_usd as "Percent Fee USD", oah.fixed_fee_usd as "Fixed Fee USD", oah.total_amount_usd as "Total Amount USD", oah.num_of_orders as "Number of Orders"
                SELECT oah.hour as "time", st.status, tk.token_symbol as "symbol", oah.amount_usd, oah.percent_fee_usd, oah.fixed_fee_usd, oah.total_amount_usd, oah.num_of_orders
                FROM orders_agg_by_hour oah
                INNER JOIN silver_tokens tk ON oah.token_id = tk.id
                INNER JOIN silver_order_status st ON oah.status_id = st.id
                ORDER BY oah.hour
            `);
            await client.query('COMMIT');
            console.log('Views made successfully');
        } catch (e: any) {
            await client.query('ROLLBACK');
            console.error('Error making views:', e);
            throw e;
        } finally {
            client.release();
        }
    }
}