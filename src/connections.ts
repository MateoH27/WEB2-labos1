import pg from 'pg'
import dbConfig from './databaseConfig'

const {Pool} = pg
const pool = new Pool(dbConfig);

export default pool;