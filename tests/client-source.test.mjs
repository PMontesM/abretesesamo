import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { clientSource } from '../src/html/client.js';
import {page} from '../src/html/shared.js';
test('fuente del navegador independiente de funciones auxiliares del empaquetador',()=>{
 const source=readFileSync(new URL('../frontend/src/entry-runtime.js',import.meta.url),'utf8').replace(/^\uFEFF/,'').replace('export function clientApp','function clientApp');
 assert.equal(clientSource,source,'Ejecuta node tools/build-client.mjs después de cambiar client-runtime.js');
 assert.ok(!clientSource.includes('__name('));
 const html=page('Ingresar',{mode:'account-login'});
 const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
 assert.equal(scripts.length,0,'No debe haber scripts ejecutables en línea');
 new vm.Script(clientSource);
 assert.match(html,/<script defer src="\/assets\/entry-[^"]+\.js"><\/script>/);
 assert.equal(JSON.parse(html.match(/id="app-config">([\s\S]*?)<\/script>/)[1]).mode,'account-login');
});
