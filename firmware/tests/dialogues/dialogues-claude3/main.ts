import { Claude3Dialogue } from 'dialogue-claude3'

const token = 'YOUR_API_KEY_HERE'

const dialogue = new Claude3Dialogue({ 
    apiKey: token
 })

const result = await dialogue.post("こんにちは");
if(result.success){
    trace(result.value)
}
