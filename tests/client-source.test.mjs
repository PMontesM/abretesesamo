import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { clientSource } from '../src/html/client.js';
import { getPlatformLoginHTML } from '../src/html/platform.js';
test('fuente del navegador independiente de funciones auxiliares del empaquetador',()=>{
 const source=readFileSync(new URL('../src/html/client-runtime.js',import.meta.url),'utf8').replace(/^\uFEFF/,'').replace('export function clientApp','function clientApp');
 assert.equal(clientSource,source,'Ejecuta node tools/build-client.mjs después de cambiar client-runtime.js');
 assert.ok(!clientSource.includes('__name('));
 const html=getPlatformLoginHTML();
 const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
 assert.equal(scripts.length,1);
 new vm.Script(scripts[0][1]);
 assert.ok(scripts[0][1].includes(clientSource));
});
