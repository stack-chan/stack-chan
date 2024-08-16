import config from "mc/config";
import { ClaudeDialogue } from 'dialogue-claude'

const token = config.token

if(!token || token == "YOUR_API_KEY_HERE")
    throw new Error("API token is missing.");

const dialogue = new ClaudeDialogue({ 
    apiKey: token
 })

const result = await dialogue.post("こんにちは");
if(result.success){
    trace(result.value)
}
