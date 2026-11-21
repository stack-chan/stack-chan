import { AccountSession } from 'muse-pairing-native'
import MuseAccountNative from 'muse-account-native'
import { createDeviceAccountNetwork } from 'muse-setup/device-account-network'
import { MuseChatSession } from 'muse-chat-session'
import { createAudioNoteBody } from 'muse-audio-note'
import metadata from 'muse-setup-metadata'
import Resource from 'Resource'
import RNG from 'rng'
import { museSessionId } from 'muse-session-id'
import TextEncoder from 'text/encoder'
import TextDecoder from 'text/decoder'
import Timer from 'timer'
import Time from 'time'
const report = value => { if (/^[a-z_0-9]{1,60}$/.test(value)) trace(`MUSE_CONNECT note_${value}\n`) }
Timer.set(async () => {
 let account, network, chat, phase='network'
 trace('MUSE_PROBE start\n')
 try {
  account=AccountSession.restore()
  network=createDeviceAccountNetwork(()=>{},()=>{})
  await network.prepare(account, account.generation)
  await account.connectApproved(account.generation)
  const encoder=new TextEncoder(),decoder=new TextDecoder()
  const options={nodeId:metadata().nodeId,sessionId:museSessionId(new Uint8Array(RNG.get(16)))}
  chat=new MuseChatSession(options,{
   open:(_,cb)=>new MuseAccountNative(account,cb,'hatch-web'),
   encode:s=>encoder.encode(s).buffer, decode:b=>decoder.decode(b),
   now:()=>Time.ticks,setTimer:(cb,ms)=>Timer.set(cb,ms),clearTimer:h=>Timer.clear(h),onDiagnostic:report
  })
  phase='connect';await chat.connect();report('synthetic_connected')
  phase='text';const text=await chat.send({message:'Connection test. Reply only Hello. Do not perform searches or external actions.',outputModality:'voice'})
  report(text.status==='completed'?'synthetic_text_pass':'synthetic_text_incomplete')
  phase='tts';const mp3=await chat.readTts(text.messages[0].id);report(mp3.byteLength?'synthetic_tts_pass':'synthetic_tts_empty')
  phase='audio';const pcm=new Uint8Array(new Resource('synthetic-note.pcm'))
  const result=await chat.sendBody(createAudioNoteBody(pcm,{...options,outputModality:'voice'}))
  report(result.status==='completed'?'synthetic_audio_pass':'synthetic_audio_incomplete')
 }catch(error){report(`synthetic_failed_${phase}`);report(['resource_exhausted','deadline_exceeded','device_busy','provider_failed'].includes(error?.code)?`error_${error.code}`:'error_unknown')}
 finally{chat?.close();network?.close();account?.close();trace('MUSE_PROBE closed\n')}
},1000)
