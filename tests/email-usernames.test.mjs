import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { username } from '../src/lib/security.js';
import { makeDB } from './db.mjs';
import worker from '../src/index.js';
import * as data from '../src/lib/db.js';

test('nombre simple y correo comparten validación en migración, alta e inicio de sesión', async () => {
  assert.equal(username(' demo.owner@example.com '),'demo.owner@example.com');
  assert.equal(username('USER+VISITAS@EXAMPLE.COM'),'user+visitas@example.com');
  assert.equal(username('admin_1'),'admin_1');
  for (const bad of ['a@@example.com','a@','<img>','a b@example.com','a'.repeat(255)]) assert.throws(()=>username(bad));

  const { sqlite, db, migrate } = makeDB({legacy:true});
  sqlite.exec("INSERT INTO tenants VALUES('a','alpha','Alpha',1,'active');");
  sqlite.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run('u','a','Resident+Door@Example.com','123456','master',1);
  sqlite.prepare('INSERT INTO platform_admins VALUES(?,?,?,?)').run('p','DEMO.OWNER@example.com','123456',1);
  migrate();
  const dir=mkdtempSync(join(tmpdir(),'gate-email-test-'));
  try {
    writeFileSync(join(dir,'users.json'),JSON.stringify([{results:sqlite.prepare('SELECT * FROM users').all()}]));
    writeFileSync(join(dir,'admins.json'),JSON.stringify([{results:sqlite.prepare('SELECT * FROM platform_admins').all()}]));
    execFileSync(process.execPath,[fileURLToPath(new URL('./fixtures/legacy/migrate-credentials.mjs',import.meta.url)),join(dir,'users.json'),join(dir,'admins.json'),join(dir,'credentials.sql')]);
    sqlite.exec(readFileSync(join(dir,'credentials.sql'),'utf8'));
    const env={DB:db,ADMIN_SIGNING_SECRET:'test-only-signing-key-with-at-least-32-characters'};
    async function login(path,name,secret){
      return worker.fetch(new Request('https://app.test'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:name,secret})}),env,{});
    }
    for (const [path,name] of [['/platform/login','demo.owner@example.com'],['/t/alpha/api/login','RESIDENT+DOOR@EXAMPLE.COM']]) {
      const response=await login(path,name,'123456');
      assert.equal(response.status,200,await response.text());
      assert.ok(response.headers.get('Set-Cookie'));
    }
    const id=await data.createUser(env,'a',{username:'New.User@example.com',secret:'password-test',gateIds:[]});
    assert.equal(sqlite.prepare('SELECT username FROM users WHERE id=?').get(id).username,'new.user@example.com');
    assert.equal((await login('/t/alpha/api/login','new.user@example.com','password-test')).status,200);
    await assert.rejects(data.createUser(env,'a',{username:'NEW.USER@EXAMPLE.COM',secret:'password-test',gateIds:[]}),/ya existe/);
  } finally {
    sqlite.close();
    assert.equal(dirname(resolve(dir)),resolve(tmpdir()));
    assert.ok(basename(dir).startsWith('gate-email-test-'));
    rmSync(dir,{recursive:true,force:true});
  }
});
