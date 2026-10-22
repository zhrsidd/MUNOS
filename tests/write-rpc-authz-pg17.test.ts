import {realDatabase} from './helpers/postgres';
import {postgresEngine} from './helpers/authz-engine';
import {registerAuthzSuite} from './helpers/authz-suite';

// The same HD10 matrix as PGlite, using actual database roles on disposable loopback PostgreSQL 17.
registerAuthzSuite('PostgreSQL 17',async()=>{
 const db=await realDatabase(process.env.TEST_POSTGRES_URL!);
 return {engine:postgresEngine(db.owner),ids:db.ids,close:()=>db.close()};
},{skip:process.env.TEST_POSTGRES_URL?false:'Set TEST_POSTGRES_URL to a loopback PostgreSQL 17 server'});
