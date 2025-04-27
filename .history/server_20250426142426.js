require('dotenv').config();

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const bodyParser = require('body-parser');
const { Buffer } = require('buffer');
const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');

const bedrock = new BedrockRuntimeClient({ region: 'us-west-2' });

const app = express();
app.use(cors());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const VOICE_API_URL = 'https://persona-sound.data.gamania.com/api/v1/public/voice';
const VOICE_API_TOKEN = '你的token';
const SPEAKER_NAME = 'chiachi';
const MODEL_ID = 4;

function classifyEmotion(text) {
  const t = text.toLowerCase();
  if (['加油','鼓勵','元氣'].some(w => t.includes(w))) return 'encouraging';
  if (['開心','快樂','棒','好開心'].some(w => t.includes(w))) return 'happy';
  if (['難過','失敗','累了','想哭','傷心'].some(w => t.includes(w))) return 'sad';
  return 'neutral';
}

async function synthesizeWithGamania(text) {
  const resp = await axios.get(VOICE_API_URL, {
    headers: {
      'Authorization': `Bearer ${VOICE_API_TOKEN}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    },
    params: {
      text,
      model_id: MODEL_ID,
      speaker_name: SPEAKER_NAME,
      speed_factor: 1,
      mode: 'stream'
    },
    responseType: 'arraybuffer'
  });
  return resp.data;
}

app.post('/idol-reply', async (req, res) => {
  try {
    const message = req.body.message;
    const bedrockBody = {
      messages: [{
        role: 'user',
        content: `你是一位受人喜愛的虛擬偶像。收到以下粉絲訊息後，請用溫暖自然、輕鬆、正能量的語氣做出簡短的回應。\n粉絲訊息：「${message}」`
      }]
    };
    const invokeParamsText = {
      modelId: 'anthropic.claude-3-sonnet-20240229-v1:0',
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(bedrockBody)
    };
    const textResp = await bedrock.send(new InvokeModelCommand(invokeParamsText));
    const textResult = JSON.parse(Buffer.from(textResp.body).toString());
    const idolReply = textResult.content ? textResult.content[0].text.trim() : (textResult.outputText || '').trim();

    const emotion = classifyEmotion(idolReply);
    const audioBuffer = await synthesizeWithGamania(idolReply);
    const audioBase64 = Buffer.from(audioBuffer).toString('base64');

    const prompts = {
      happy:  'smiling brightly, colorful dreamy anime background',
      sad:    'slightly teary but brave, soft pastel background',
      encouraging: 'confident cheering, vivid cute background',
      neutral: 'gentle calm expression, dreamy background'
    };
    const imageBody = {
      text_prompts: [{ text: `A portrait of a virtual idol girl, ${prompts[emotion]}.` }],
      cfg_scale: 10,
      seed: 0,
      steps: 50
    };
    const invokeParamsImage = {
      modelId: 'stability.stable-diffusion-xl-v1',
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(imageBody)
    };
    const imgResp = await bedrock.send(new InvokeModelCommand(invokeParamsImage));
    const imageBase64 = Buffer.from(imgResp.body).toString('base64');

    res.json({
      idol_reply: idolReply,
      audio_base64: audioBase64,
      image_base64: imageBase64
    });

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: `伺服器錯誤：${e.message}` });
  }
});

app.get('/', (req, res) => res.json({ message: 'Hello Idol' }));

const PORT = 8000;
app.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
