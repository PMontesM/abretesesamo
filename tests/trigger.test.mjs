import test from 'node:test';
import assert from 'node:assert/strict';
import {triggerGate} from '../src/index.js';
const gate=(method='GET')=>({id:'g',status:'active',trigger_type:'webhook',trigger_config:JSON.stringify({url:'https://provider.test/trigger?token=private',method})});
test('sigue redirecciones HTTPS y no repite el disparador',async()=>{
 const calls=[];
 globalThis.fetch=async(url,options)=>{calls.push({url,method:options.method});return calls.length===1?new Response(null,{status:302,headers:{Location:'/result'}}):new Response('OK');};
 await triggerGate(gate());assert.equal(calls.length,2);assert.equal(calls[1].url,'https://provider.test/result');
});
test('respeta semántica de método 303 y 307',async()=>{
 for(const status of [303,307]){
  const methods=[];globalThis.fetch=async(url,options)=>{methods.push(options.method);return methods.length===1?new Response(null,{status,headers:{Location:'/result'}}):new Response('OK');};
  await triggerGate(gate('POST'));assert.deepEqual(methods,['POST',status===303?'GET':'POST']);
 }
});
test('HTTP y fallos de conexión informan motivo sin exponer claves ni reintentar',async()=>{
 let count=0;globalThis.fetch=async()=>{count++;return new Response('private-token',{status:403});};
 await assert.rejects(triggerGate(gate()),/^Error: El proveedor respondió HTTP 403$/);assert.equal(count,1);
 globalThis.fetch=async()=>{throw Error('secret URL https://private.test/token');};
 await assert.rejects(triggerGate(gate()),/^Error: No se pudo conectar con el proveedor$/);
});
test('bloquea ciclos y redirecciones a HTTP sin ejecutar otra orden',async()=>{
 for(const location of ['https://provider.test/trigger?token=private','http://provider.test/result']){
  let count=0;globalThis.fetch=async()=>{count++;return new Response(null,{status:302,headers:{Location:location}});};
  await assert.rejects(triggerGate(gate()));assert.equal(count,1);
 }
});
