// server.js
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const axios = require('axios');
const { Buffer } = require('buffer');
const {
  BedrockRuntimeClient,
  InvokeModelCommand
} = require('@aws-sdk/client-bedrock-runtime');

// ==== AWS & Bedrock Setup ====
const REGION = process.env.AWS_REGION || 'us-west-2';
const bedrock = new BedrockRuntimeClient({ region: REGION });

// ==== Gamania TTS Setup ====
const VOICE_API_URL = 'https://persona-sound.data.gamania.com/api/v1/public/voice';
const VOICE_API_TOKEN = process.env.VOICE_API_TOKEN;
const SPEAKER_NAME = 'chiachi';
const TTS_MODEL_ID = 4;

async function synthesizeWithGamania(text) {
  const resp = await axios.get(VOICE_API_URL, {
    headers: {
      'Authorization': `Bearer ${VOICE_API_TOKEN}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    },
    params: {
      text,
      model_id: TTS_MODEL_ID,
      speaker_name: SPEAKER_NAME,
      speed_factor: 1,
      mode: 'stream'
    },
    responseType: 'arraybuffer'
  });
  return resp.data;
}

// ==== Helper: Emotion Classification ====
function classifyEmotion(text) {
  const t = text.toLowerCase();
  if (['加油','鼓勵','元氣'].some(w => t.includes(w))) return 'encouraging';
  if (['開心','快樂','棒','好開心'].some(w => t.includes(w))) return 'happy';
  if (['難過','失敗','累了','想哭','傷心'].some(w => t.includes(w))) return 'sad';
  return 'neutral';
}

// ==== Express App ====
const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '20mb' }));

app.post('/idol-reply', async (req, res) => {
  try {
    const { message, imageBase64 } = req.body;
    if (!message || !imageBase64) {
      return res.status(400).json({ error: '需要 message 與 imageBase64' });
    }

    // 1️⃣ 文字生成 (Claude)
    let idolReply = '';
    let emotion = 'neutral';
    try {
      const textBody = {
        messages: [{
          role: 'user',
          content: `你是一位受人喜愛的虛擬偶像。請用溫暖正能量的語氣回覆：\n粉絲：「${message}」`
        }],
        max_tokens: 500,
        anthropic_version: 'bedrock-2023-05-31'
      };
      const textCmd = new InvokeModelCommand({
        modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify(textBody)
      });
      const txtResp = await bedrock.send(textCmd);
      const txtJson = JSON.parse(Buffer.from(txtResp.body).toString());
      idolReply = (txtJson.content?.[0]?.text || txtJson.outputText || '').trim();
      emotion = classifyEmotion(idolReply);
    } catch (e) {
      console.error('▶️ 文字生成失敗', e);
      idolReply = '嗨～謝謝你的訊息！';
    }

    // 2️⃣ 語音合成 (Gamania TTS)
    let audioBase64 = '';
    try {
      const audioBuffer = await synthesizeWithGamania(idolReply);
      audioBase64 = Buffer.from(audioBuffer).toString('base64');
    } catch (e) {
      console.error('▶️ TTS 合成失敗', e);
    }

    // 3️⃣ Titan G1 v2 In-Painting (局部编辑)
    const prompts = {
      happy: 'A gentle, happy smile. Lift the corners of the mouth slightly.',
      sad: 'A subtle sad expression. Turn the corners of the mouth downward slightly.',
      encouraging: 'A warm, encouraging smile.',
      neutral: 'A calm, neutral expression.'
    };
    const inputImage = imageBase64.split(',')[1] || imageBase64;

    const inPaintingParams = {
      image: inputImage,
      maskPrompt: 'face',
      text: prompts[emotion],
      negativeText: 'different face, horror, exaggerated expression, deformed face'
    };
    const requestBody = {
      taskType: 'INPAINTING',
      inPaintingParams,
      imageGenerationConfig: {
        numberOfImages: 1,
        height: 512,
        width: 512,
        cfgScale: 7.0
      }
    };

    let imageOut = '';
    try {
      const imgCmd = new InvokeModelCommand({
        modelId: 'amazon.titan-image-generator-v2:0',
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify(requestBody)
      });
      const imgResp = await bedrock.send(imgCmd);
      const imgJson = JSON.parse(Buffer.from(imgResp.body).toString());
      imageOut = imgJson.images?.[0] || '';
    } catch (e) {
      console.error('▶️ 图像编辑失败', e);
    }

    // 4️⃣ 回前端
    res.json({
      idol_reply: idolReply,
      audio_base64: audioBase64,
      image_base64: imageOut
    });

  } catch (err) {
    console.error('❌ 全流程错误', err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));

