import config from "mc/config";
import { ClaudeDialogue } from 'dialogue-claude'

const token = config.token

const dialogue = new ClaudeDialogue({ 
    apiKey: token
 })

const result = await dialogue.post("こんにちは");
if(result.success){
    trace(result.value)
}
