import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
export function makeDB({legacy=false}={}){
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec('PRAGMA foreign_keys=ON');
 sqlite.exec(readFileSync(new URL(legacy?'./fixtures/legacy/schema.sql':'../database/schema.sql',import.meta.url),'utf8'));
 if(legacy)sqlite.exec(readFileSync(new URL('./fixtures/legacy/migration_002_platform.sql',import.meta.url),'utf8'));
 const wrap={
  prepare(sql){return {bind(...params){return stmt(sql,params);},...stmt(sql,[])};},
  async batch(statements){sqlite.exec('BEGIN');try{const out=[];for(const s of statements)out.push(await s.run());sqlite.exec('COMMIT');return out;}catch(e){sqlite.exec('ROLLBACK');throw e;}}
 };
 function stmt(sql,params){return {async first(){return sqlite.prepare(sql).get(...params)||null;},async all(){return {results:sqlite.prepare(sql).all(...params)};},async run(){return {meta:sqlite.prepare(sql).run(...params)};}};}
 return {sqlite,db:wrap,migrate(){if(legacy){sqlite.exec(readFileSync(new URL('./fixtures/legacy/migration_003_access.sql',import.meta.url),'utf8'));sqlite.exec(readFileSync(new URL('../database/migration_004_audit.sql',import.meta.url),'utf8'));sqlite.exec(readFileSync(new URL('../database/migration_005_visit.sql',import.meta.url),'utf8'));sqlite.exec(readFileSync(new URL('../database/migration_006_support.sql',import.meta.url),'utf8'));sqlite.exec(readFileSync(new URL('../database/migration_007_mqtt.sql',import.meta.url),'utf8'));sqlite.exec(readFileSync(new URL('../database/migration_008_relay_inventory.sql',import.meta.url),'utf8'));sqlite.exec(readFileSync(new URL('../database/migration_009_frontend.sql',import.meta.url),'utf8'));sqlite.exec(readFileSync(new URL('../database/migration_010_accounts.sql',import.meta.url),'utf8'));}}};
}
