// server.js
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const axios = require('axios');
const { Buffer } = require('buffer');
const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');

// ==== AWS & Bedrock Setup ====
const REGION = process.env.AWS_REGION || 'us-west-2';
const bedrock = new BedrockRuntimeClient({ region: REGION });

// ==== Gamania TTS Setup ====
const VOICE_API_URL = 'https://persona-sound.data.gamania.com/api/v1/public/voice';
const VOICE_API_TOKEN = process.env.VOICE_API_TOKEN;
const SPEAKER_NAME = 'junting';
const TTS_MODEL_ID = 5;

async function synthesizeWithGamania(text) {
  const resp = await axios.get(VOICE_API_URL, {
    headers: {
      'Authorization': `Bearer ${VOICE_API_TOKEN}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    },
    params: { text, model_id: TTS_MODEL_ID, speaker_name: SPEAKER_NAME, speed_factor: 1, mode: 'stream' },
    responseType: 'arraybuffer'
  });
  return resp.data;
}

// ==== Helper: AI-based Emotion Classification ====
async function classifyEmotionAI(text) {
  const prompt = `Please classify the sentiment of the following text as one of exactly: happy, sad, angry, encouraging, or neutral. Respond with only the label without additional text.\n\nText: "${text}"`;
  const body = {
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 4,
    temperature: 0,
    anthropic_version: 'bedrock-2023-05-31'
  };
  const cmd = new InvokeModelCommand({
    modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(body)
  });
  const resp = await bedrock.send(cmd);
  const data = JSON.parse(Buffer.from(resp.body).toString());
  const label = (data.content?.[0]?.text || data.outputText || '').trim().toLowerCase();
  console.log('Detected emotion label:', label);
  if (label.includes('sad')) return 'sad';
  if (label.includes('angry')) return 'angry';
  if (label.includes('happy')) return 'happy';
  if (label.includes('encouraging')) return 'encouraging';
  return 'neutral';
}

// ==== Helper: Language Detection ====
async function detectLanguage(text) {
  const prompt = `Please identify the language of the following text. Respond with only the language code (e.g., "en", "zh", "ja", etc.) without any additional text.\n\nText: "${text}"`;
  const body = {
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 5,
    temperature: 0,
    anthropic_version: 'bedrock-2023-05-31'
  };
  const cmd = new InvokeModelCommand({
    modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(body)
  });
  const resp = await bedrock.send(cmd);
  const data = JSON.parse(Buffer.from(resp.body).toString());
  const language = (data.content?.[0]?.text || data.outputText || '').trim().toLowerCase();
  console.log('檢測到的語言:', language);
  return language;
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

    // 1️⃣ Generate reply text with Claude
    let idolReply = '';
    try {
      // 先檢測輸入的語言
      const detectedLang = await detectLanguage(message);
      
      // 根據檢測到的語言調整提示
      let prompt = '';
      if (detectedLang.includes('ja')) {
        prompt = `あなたは台湾の男性アイドルです。ファンからのメッセージに対して、温かく前向きな日本語で返信してください: "${message}"`;
      } else if (detectedLang.includes('zh')) {
        prompt = `你是一位台灣男性偶像。請用溫暖正能量的語氣，以中文回覆粉絲的訊息：「${message}」`;
      } else {
        prompt = `You are emulating a real Taiwanese male idol. Please reply warmly and positively in English to the fan's message: "${message}"`;
      }
      
      const textBody = {
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 500,
        temperature: 0.7,
        anthropic_version: 'bedrock-2023-05-31'
      };
      const textCmd = new InvokeModelCommand({ modelId: 'anthropic.claude-3-haiku-20240307-v1:0', contentType: 'application/json', accept: 'application/json', body: JSON.stringify(textBody) });
      const txtResp = await bedrock.send(textCmd);
      const txtJson = JSON.parse(Buffer.from(txtResp.body).toString());
      idolReply = (txtJson.content?.[0]?.text || txtJson.outputText || '').trim();
    } catch (e) {
      console.error('▶️ Text generation failed', e);
      idolReply = 'Hi, thanks for your message!';
    }

    // 2️⃣ Classify emotion via AI
    let emotion = 'neutral';
    try {
      emotion = await classifyEmotionAI(idolReply);
    } catch (e) {
      console.error('▶️ Emotion classification failed', e);
    }
    console.log('Final emotion used for prompt:', emotion);

    // 3️⃣ Synthesize speech
    let audioBase64 = '';
    try {
      const audioBuffer = await synthesizeWithGamania(idolReply);
      audioBase64 = Buffer.from(audioBuffer).toString('base64');
    } catch (e) {
      console.error('▶️ TTS failed', e);
    }

    // 4️⃣ Titan G1 v2 In-Painting for expression only
        // 仅保留最基础的表情提示，避免触发过滤器
    const prompts = {
      happy: 'A genuine happy smile, keep identity unchanged. Chinese face',
      sad: 'A subtle sad expression, keep identity unchanged. Chinese face',
      angry: 'A mild angry expression with furrowed brows, keep identity unchanged. Chinese face',
      encouraging: 'An encouraging warm smile, keep identity unchanged. Chinese face',
      neutral: 'A calm neutral expression, keep identity unchanged. Chinese face'
    };
    const inpaintPrompt = prompts[emotion] || prompts.neutral;
    console.log('In-painting prompt:', inpaintPrompt);

    const inputImage = imageBase64.split(',')[1] || imageBase64;
    const inPaintingParams = { image: inputImage, maskPrompt: 'face', text: inpaintPrompt, negativeText: 'distorted, horror, deformed' };
    const requestBody = { taskType: 'INPAINTING', inPaintingParams, imageGenerationConfig: { numberOfImages: 1, height: 512, width: 512, cfgScale: 7.0 } };

    let imageOut = '';
    try {
      const imgCmd = new InvokeModelCommand({ modelId: 'amazon.titan-image-generator-v2:0', contentType: 'application/json', accept: 'application/json', body: JSON.stringify(requestBody) });
      const imgResp = await bedrock.send(imgCmd);
      const imgJson = JSON.parse(Buffer.from(imgResp.body).toString());
      imageOut = imgJson.images?.[0] || '';
    } catch (e) {
      console.error('▶️ Image in-painting failed', e);
    }

    // 5️⃣ Send response
    res.json({ idol_reply: idolReply, audio_base64: audioBase64, image_base64: imageOut });
  } catch (err) {
    console.error('❌ Full pipeline error', err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
