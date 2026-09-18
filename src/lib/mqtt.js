// Deliberately short-lived MQTT 3.1.1 client for the Workers WebSocket runtime.
// No reconnect, persistent session or automatic PUBLISH retry is allowed.
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const endpoint='https://95cad9bec61b432488ee5d0d0ef98773.s1.eu.hivemq.cloud:8884/mqtt';
const bytes=(...parts)=>Uint8Array.from(parts.flatMap(p=>typeof p==='number'?[p]:Array.from(p)));
const word=n=>[n>>8,n&255];
const string=s=>{const b=encoder.encode(s);if(b.length>65535)throw Error('MQTT string too long');return bytes(word(b.length),b);};
export function packet(header,body=[]){let n=body.length,length=[];do{let b=n%128;n=Math.floor(n/128);length.push(b|(n?128:0));}while(n);return bytes(header,length,body);}
export class MQTTClient {
  constructor(ws){
    this.ws=ws;this.buffer=new Uint8Array();this.events=[];this.waiters=new Set();this.sequence=0;this.error=null;
    ws.binaryType='arraybuffer';
    ws.addEventListener('message',e=>{try{if(!(e.data instanceof ArrayBuffer))throw Error('MQTT binary frame expected');this.receive(new Uint8Array(e.data));}catch{this.fail(Error('Respuesta MQTT inválida'));}});
    ws.addEventListener('close',()=>this.fail(Error('La conexión MQTT se cerró')));
    ws.addEventListener('error',()=>this.fail(Error('Falló la conexión MQTT')));
    ws.accept();
  }
  static async connect(username,password,options={}){
    const {fetcher=fetch,endpoint:target=endpoint}=typeof options==='function'?{fetcher:options}:options;
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),6000);
    let response;
    try{response=await fetcher(target,{headers:{Upgrade:'websocket','Sec-WebSocket-Protocol':'mqtt'},redirect:'manual',signal:controller.signal});}
    catch{throw Error('No se pudo conectar con el servidor MQTT');}finally{clearTimeout(timer);}
    if(response.status!==101||!response.webSocket)throw Error('El servidor MQTT no aceptó la conexión WebSocket');
    const client=new MQTTClient(response.webSocket);
    try{
      client.send(packet(0x10,bytes(string('MQTT'),4,0xc2,word(30),string('worker-'+crypto.randomUUID()),string(username),string(password))));
      const reply=await client.wait(e=>e.type===2,6000);
      if(reply.body.length!==2||reply.body[0]!==0||reply.body[1]!==0)throw Error('HiveMQ rechazó las credenciales');
      return client;
    }catch(e){client.close();throw e;}
  }
  send(data){if(this.error)throw this.error;this.ws.send(data);}
  emit(event){
    for(const w of this.waiters)if(w.matches(event)){clearTimeout(w.timer);this.waiters.delete(w);w.resolve(event);return;}
    this.events.push(event);if(this.events.length>1024)this.fail(Error('Demasiados mensajes MQTT'));
  }
  wait(matches,timeout=6000){
    const i=this.events.findIndex(matches);if(i>=0)return Promise.resolve(this.events.splice(i,1)[0]);
    if(this.error)return Promise.reject(this.error);
    return new Promise((resolve,reject)=>{const w={matches,resolve,reject};w.timer=setTimeout(()=>{this.waiters.delete(w);reject(Object.assign(Error('El servidor MQTT o el dispositivo no respondió a tiempo'),{code:'MQTT_TIMEOUT'}));},timeout);this.waiters.add(w);});
  }
  receive(chunk){
    this.buffer=bytes(this.buffer,chunk);if(this.buffer.length>65536)throw Error('MQTT packet too large');
    while(this.buffer.length>=2){
      let n=0,m=1,i=1,b;
      do{if(i>=this.buffer.length)return;if(i>4)throw Error('Invalid MQTT length');b=this.buffer[i++];n+=(b&127)*m;m*=128;}while(b&128);
      if(n>32768)throw Error('MQTT packet too large');if(this.buffer.length<i+n)return;
      const header=this.buffer[0],body=this.buffer.slice(i,i+n);this.buffer=this.buffer.slice(i+n);
      const type=header>>4;
      if(type===3){
        const qos=(header>>1)&3;if(body.length<2||qos>1)throw Error('Invalid PUBLISH');
        const len=body[0]*256+body[1];let offset=2+len;
        if(!len||offset+(qos?2:0)>body.length)throw Error('Invalid topic');
        const topic=decoder.decode(body.slice(2,offset));
        if(qos){const id=body.slice(offset,offset+2);if(!id[0]&&!id[1])throw Error('Invalid packet ID');this.send(packet(0x40,id));offset+=2;}
        this.emit({type,topic,payload:decoder.decode(body.slice(offset)),retained:Boolean(header&1)});
      }else if([2,4,9,13].includes(type)){
        if(header&15)throw Error('Invalid MQTT flags');
        this.emit({type,body,id:body.length>=2?body[0]*256+body[1]:0});
      }else throw Error('Unexpected MQTT packet');
    }
  }
  async subscribe(topics){
    const id=++this.sequence;this.send(packet(0x82,bytes(word(id),...topics.map(t=>bytes(string(t),1)))));
    const reply=await this.wait(e=>e.type===9&&e.id===id);
    if(reply.body.length!==topics.length+2||Array.from(reply.body.slice(2)).some(v=>v!==0&&v!==1))throw Error('HiveMQ no permite consultar este dispositivo');
  }
  publish(topic,payload){
    const id=++this.sequence;
    // QoS 1, RETAIN=0, DUP=0. PUBACK is broker receipt, never relay confirmation.
    this.send(packet(0x32,bytes(string(topic),word(id),encoder.encode(payload))));
  }
  fail(error){if(this.error)return;this.error=error;for(const w of this.waiters){clearTimeout(w.timer);w.reject(error);}this.waiters.clear();}
  close(){try{if(!this.error)this.ws.send(packet(0xe0));}catch{}this.fail(Error('Conexión MQTT finalizada'));try{this.ws.close(1000,'done');}catch{}}
}
