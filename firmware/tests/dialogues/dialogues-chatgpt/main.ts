import config from "mc/config";
import { ChatGPTDialogue } from 'dialogue-chatgpt'

const token = config.token

const dialogue = new ChatGPTDialogue({ 
    apiKey: token
 })

const result = await dialogue.post("こんにちは");

if(result.success){
    trace(result.value)
}
