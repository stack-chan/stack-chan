import config from "mc/config";
import { GeminiDialogue } from 'dialogue-gemini'

const token = config.token

const dialogue = new GeminiDialogue({ 
    apiKey: token
 })

const result = await dialogue.post("こんにちは");
if(result.success){
    trace(result.value)
}
