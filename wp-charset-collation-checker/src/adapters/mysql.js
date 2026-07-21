// Live MySQL adapter. `mysql2` is an OPTIONAL dependency, imported lazily —
// this module is only loaded when a command actually targets a live DB, and it
// fails with a clear message if the driver isn't installed. Tests never load it.
//
//   npm i mysql2   # only needed to scan/convert a real database

export class MysqlAdapter {
  constructor(conn, dbName) {
    this.conn = conn;
    this.dbName = dbName;
  }

  static async create({ host = '127.0.0.1', port = 3306, name, user, password }) {
    let mysql;
    try {
      mysql = await import('mysql2/promise');
    } catch {
      throw new Error(
        'live DB access needs the optional `mysql2` driver: run `npm i mysql2`, ' +
          'or use the offline fixture adapter (db.fixture / --fixture).'
      );
    }
    const conn = await mysql.createConnection({
      host, port, user, password, database: name,
      charset: 'utf8mb4',
    });
    return new MysqlAdapter(conn, name);
  }

  async fetchSnapshot() {
    const db = this.dbName;
    const [[schema]] = await this.conn.query(
      `SELECT DEFAULT_CHARACTER_SET_NAME AS charset, DEFAULT_COLLATION_NAME AS collation
         FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?`, [db]);

    const [tableRows] = await this.conn.query(
      `SELECT t.TABLE_NAME AS name, t.ROW_FORMAT AS rowFormat,
              t.TABLE_COLLATION AS collation, ccsa.CHARACTER_SET_NAME AS charset
         FROM information_schema.TABLES t
         JOIN information_schema.COLLATION_CHARACTER_SET_APPLICABILITY ccsa
           ON ccsa.COLLATION_NAME = t.TABLE_COLLATION
        WHERE t.TABLE_SCHEMA = ? AND t.TABLE_TYPE = 'BASE TABLE'
        ORDER BY t.TABLE_NAME`, [db]);

    const [columnRows] = await this.conn.query(
      `SELECT TABLE_NAME AS tbl, COLUMN_NAME AS name, DATA_TYPE AS dataType,
              CHARACTER_MAXIMUM_LENGTH AS length,
              CHARACTER_SET_NAME AS charset, COLLATION_NAME AS collation
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION`, [db]);

    const [indexRows] = await this.conn.query(
      `SELECT TABLE_NAME AS tbl, INDEX_NAME AS name, NON_UNIQUE AS nonUnique,
              COLUMN_NAME AS col, SUB_PART AS subPart, SEQ_IN_INDEX AS seq
         FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`, [db]);

    const [fkRows] = await this.conn.query(
      `SELECT TABLE_NAME AS tbl, COLUMN_NAME AS col,
              REFERENCED_TABLE_NAME AS refTable, REFERENCED_COLUMN_NAME AS refColumn
         FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL`, [db]);

    const [connRows] = await this.conn.query(
      `SHOW VARIABLES WHERE Variable_name IN
        ('character_set_client','character_set_connection','character_set_results','collation_connection')`);

    const tables = tableRows.map((t) => ({
      name: t.name,
      charset: t.charset,
      collation: t.collation,
      rowFormat: t.rowFormat,
      columns: columnRows
        .filter((c) => c.tbl === t.name)
        .map(({ name, dataType, length, charset, collation }) => ({
          name, dataType, length: length == null ? undefined : Number(length), charset, collation,
        })),
      indexes: groupIndexes(indexRows.filter((i) => i.tbl === t.name)),
      foreignKeys: fkRows
        .filter((f) => f.tbl === t.name)
        .map(({ col, refTable, refColumn }) => ({ column: col, refTable, refColumn })),
    }));

    const connection = {};
    for (const row of connRows) connection[row.Variable_name] = row.Value;

    return {
      database: { name: db, charset: schema?.charset, collation: schema?.collation },
      connection,
      tables,
    };
  }

  async execute(sql) {
    await this.conn.query(sql);
  }

  /** Store and read back a value through a scratch row (used by post-convert verify). */
  async roundTrip(tableName, columnName, text) {
    const [rows] = await this.conn.query(
      `SELECT CAST(? AS CHAR) AS v, HEX(CONVERT(? USING utf8mb4)) AS hex`, [text, text]);
    return { storedBytes: Buffer.from(rows[0].hex, 'hex'), retrieved: rows[0].v };
  }

  async close() {
    await this.conn.end();
  }
}

function groupIndexes(rows) {
  const byName = new Map();
  for (const r of rows) {
    if (!byName.has(r.name)) byName.set(r.name, { name: r.name, unique: !r.nonUnique, columns: [] });
    byName.get(r.name).columns.push({ name: r.col, subPart: r.subPart == null ? undefined : Number(r.subPart) });
  }
  return [...byName.values()];
}
