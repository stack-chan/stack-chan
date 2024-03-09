import { ChatGPTDialogue } from 'dialogue-chatgpt'

const token = 'YOUR_API_KEY_HERE'

const dialogue = new ChatGPTDialogue({ 
    apiKey: token
 })

const result = await dialogue.post("こんにちは");

if(result.success){
    trace(result.value)
}
