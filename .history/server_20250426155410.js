// server.js
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const bodyParser = require('body-parser');
const { Buffer } = require('buffer');
const {
  BedrockRuntimeClient,
  InvokeModelCommand
} = require('@aws-sdk/client-bedrock-runtime');
const {
  BedrockClient,
  ListFoundationModelsCommand
} = require('@aws-sdk/client-bedrock');

const REGION = process.env.AWS_REGION || 'us-west-2';
const bedrock = new BedrockRuntimeClient({ region: REGION });
const bedrockMgmt = new BedrockClient({ region: REGION });

const app = express();
app.use(cors());
// 前端我們用 JSON 傳 body
app.use(bodyParser.json({ limit: '10mb' }));

// 用 Gamania 做 TTS
const VOICE_API_URL = 'https://persona-sound.data.gamania.com/api/v1/public/voice';
const VOICE_API_TOKEN = process.env.VOICE_API_TOKEN;
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
    const { message, imageBase64 } = req.body;
    if (!message || !imageBase64) {
      return res.status(400).json({ error: 'message / imageBase64 are required' });
    }

    // 1. 文字回覆 (Claude)
    const bedrockBody = {
      messages: [{
        role: 'user',
        content: `你是一位受人喜愛的虛擬偶像。收到以下粉絲訊息後，請用溫暖自然、輕鬆、正能量的語氣做出簡短的回應。\n粉絲訊息：「${message}」`
      }],
      max_tokens: 500,
      anthropic_version: "bedrock-2023-05-31"
    };
    const invokeParamsText = {
      modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(bedrockBody)
    };

    let idolReply, emotion;
    try {
      const textResp = await bedrock.send(new InvokeModelCommand(invokeParamsText));
      const textResult = JSON.parse(Buffer.from(textResp.body).toString());
      idolReply = (textResult.content?.[0]?.text || textResult.outputText || '').trim();
      emotion = classifyEmotion(idolReply);
    } catch (e) {
      console.error('▶️ 文字生成失敗', e);
      idolReply = '嗨～很高興收到你的訊息！';
      emotion = 'neutral';
    }

    // 2. 語音合成
    let audioBase64 = '';
    try {
      const audioBuf = await synthesizeWithGamania(idolReply);
      audioBase64 = Buffer.from(audioBuf).toString('base64');
    } catch (e) {
      console.error('▶️ 語音合成失敗', e);
    }

    // 3. 圖像局部編輯 (Titan In-Painting)
    //   maskPrompt: "face" 代表自動偵測人臉為編輯區域
    const emotionPrompts = {
      happy:       'Make the person look happy with a gentle smile. Lift the corners of the mouth slightly.',
      sad:         'Make the person look sad by turning the corners of the mouth downward slightly.',
      encouraging: 'Make the person look encouraging with a warm friendly smile.',
      neutral:     'Make the person look calm with a neutral expression.'
    };

    const editBody = {
      taskType: "INPAINTING",
      inputImage: imageBase64.split(',')[1] || imageBase64,
      // maskPrompt 用於自動選取要編輯的面部區域
      maskPrompt: "face",
      textPrompts: [
        { text: emotionPrompts[emotion] }
      ],
      negativeTextPrompts: [
        { text: "different face, horror, exaggerated expression, deformed face" }
      ],
      cfgScale: 7,
      steps: 60,
      seed: 0
    };

    const invokeParamsImage = {
      modelId: 'amazon.titan-image-generator-v1',
      contentType: 'application/json',
      // 我們希望拿到 raw png binary
      accept: 'application/octet-stream',
      body: JSON.stringify(editBody)
    };

    let imageBase64Out = '';
    try {
      const imgResp = await bedrock.send(new InvokeModelCommand(invokeParamsImage));
      // raw binary -> base64
      imageBase64Out = Buffer.from(imgResp.body).toString('base64');
    } catch (e) {
      console.error('▶️ 圖像編輯失敗', e);
    }

    // 4. 返回
    res.json({
      idol_reply: idolReply,
      audio_base64: audioBase64,
      image_base64: imageBase64Out
    });

  } catch (e) {
    console.error('❌ /idol-reply 全流程錯誤', e);
    res.status(500).json({ error: e.message });
  }
});

// 列模型（測試用）
app.get('/models', async (req, res) => {
  try {
    const list = await bedrockMgmt.send(new ListFoundationModelsCommand({}));
    res.json(list.modelSummaries);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
