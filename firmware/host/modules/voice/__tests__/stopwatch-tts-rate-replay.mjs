import {performance} from 'node:perf_hooks'
import {createSpeechEvents} from '../gemini-worker-events.js'
import {createResampledOutput} from '../../muse-gadget/setup-device/resampled-output.js'
String.fromArrayBuffer = (buf,start,length) => new TextDecoder().decode(new Uint8Array(buf,start,length))
Uint8Array.fromBase64 ??= (value) => new Uint8Array(Buffer.from(value, 'base64'))
const encoder = new TextEncoder()
const event = value => encoder.encode('data: '+JSON.stringify(value)+'\n\n')
const startBytes=3*4092, rateOut=32, audioMs=80, count=80
for (const stressed of [false,true]) for (const rate of [24000,16000]) {
  let queued=0, clock=0, underruns=0, gapMs=0, startupMs=null
  let latency=[], payload=0
  const output=createResampledOutput({minimumOutputBytes:0,openOutput:()=>({
    write: async bytes=>{queued+=bytes.byteLength},
    drain:async()=>{},
  }),resample:(source,offset,length,target,from,to,state)=>{
    // Portable volume-free sample-count model; live path uses native C.
    const n=Math.floor((length*to+state[0])/from)
    state[0]=(length*to+state[0])%from
    new Uint8Array(target).fill(0,0,n*2)
    return n
  }}).openOutput(rate,0,17920,undefined,3)
  const parser=createSpeechEvents({sampleRate:rate,onPcm:bytes=>output.write(bytes)})
  for(let i=0;i<count;i++){
    const receivedAt=i*audioMs+(stressed&&i>=20&&i<26?440:0)
    const arrival=Math.max(clock,receivedAt)
    if(startupMs!==null) {
      const demand=(arrival-clock)*rateOut
      if(demand>queued){underruns++;gapMs+=(demand-queued)/rateOut}
      queued=Math.max(0,queued-demand)
    }
    clock=arrival
    const samples=Buffer.alloc(rate*audioMs*2/1000)
    for(let j=0;j<samples.length/2;j++)samples.writeInt16LE(Math.round(4000*Math.sin((i*audioMs/1000+j/rate)*440*2*Math.PI)),j*2)
    const bytes=event({event_type:'step.delta',delta:{type:'audio',mime_type:'audio/l16;rate='+rate+';channels=1',data:samples.toString('base64')}})
    payload+=bytes.byteLength
    const start=performance.now()
    for(let j=0;j<bytes.length;j+=1024)await parser.feed(bytes.subarray(j,j+1024))
    latency.push(performance.now()-start)
    if(startupMs===null&&queued>=startBytes)startupMs=arrival
  }
  await parser.feed(event({event_type:'interaction.completed',interaction:{status:'completed'}}))
  await parser.finish()
  latency.sort((a,b)=>a-b)
  console.log(JSON.stringify({stressed,rate,queueP50Ms:latency[40],queueP95Ms:latency[76],startupMs,underruns,gapMs,payload}))
}
