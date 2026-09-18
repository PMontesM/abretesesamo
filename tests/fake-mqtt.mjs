import {packet} from '../src/lib/mqtt.js';
// WebSocket peer used only by browser tests. Any command publication is a failure.
export function offlineMQTT(deviceId){
  const listeners={};let ws;
  const deliver=data=>listeners.message({data:Uint8Array.from(data).buffer});
  ws={accept(){},close(){},addEventListener(name,fn){listeners[name]=fn;},send(raw){
    const data=Array.from(raw),type=data[0]>>4;let offset=1;while(data[offset++]&128){}const body=data.slice(offset);
    if(type===1)deliver(packet(0x20,[0,0]));
    if(type===3)throw Error('UI status test must never publish a command');
    if(type===8){let cursor=2,count=0;while(cursor<body.length){const len=body[cursor]*256+body[cursor+1];cursor+=len+3;count++;}deliver(packet(0x90,[body[0],body[1],...Array(count).fill(1)]));
      const topic=new TextEncoder().encode('gate/'+deviceId+'/state');deliver(packet(0x31,[0,topic.length,...topic,...new TextEncoder().encode('offline')]));
    }
  }};return {status:101,webSocket:ws};
}
