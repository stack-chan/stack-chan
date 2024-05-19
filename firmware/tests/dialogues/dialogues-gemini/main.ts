import { GeminiDialogue } from 'dialogue-gemini'

const token = 'YOUR_API_KEY_HERE'

const dialogue = new GeminiDialogue({ 
    apiKey: token
 })

const result = await dialogue.post("こんにちは");
if(result.success){
    trace(result.value)
}
