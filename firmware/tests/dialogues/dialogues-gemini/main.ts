import config from "mc/config";
import { GeminiDialogue } from 'dialogue-gemini'

const token = config.token

if(!token || token == "YOUR_API_KEY_HERE")
    throw new Error("API token is missing.");

const dialogue = new GeminiDialogue({ 
    apiKey: token
 })

const result = await dialogue.post("こんにちは");
if(result.success){
    trace(result.value)
}
