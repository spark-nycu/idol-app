// server.js
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { Buffer } = require('buffer');
const {
  BedrockRuntimeClient,
  InvokeModelCommand
} = require('@aws-sdk/client-bedrock-runtime');

const REGION = process.env.AWS_REGION || 'us-west-2';
const bedrock = new BedrockRuntimeClient({ region: REGION });

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));

function classifyEmotion(text) {
  const t = text.toLowerCase();
  if (['加油','鼓勵','元氣'].some(w => t.includes(w))) return 'encouraging';
  if (['開心','快樂','棒','好開心'].some(w => t.includes(w))) return 'happy';
  if (['難過','失敗','累了','想哭','傷心'].some(w => t.includes(w))) return 'sad';
  return 'neutral';
}

app.post('/idol-reply', async (req, res) => {
  try {
    const { message, imageBase64 } = req.body;
    if (!message || !imageBase64) {
      return res.status(400).json({ error: '需要 message 與 imageBase64' });
    }

    // 1. 文字回覆 (Claude)
    let idolReply = '';
    let emotion = 'neutral';
    try {
      const textBody = {
        messages: [{
          role: 'user',
          content: `你是一個溫暖的虛擬偶像。請用輕鬆正能量的語氣回覆：\n粉絲：「${message}」`
        }],
        max_tokens: 500,
        anthropic_version: "bedrock-2023-05-31"
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
      console.error('文字生成失敗', e);
      idolReply = '嗨，謝謝你的訊息！';
    }

    // 2. 圖像局部 In-Painting (SDXL)
    const emotionPrompts = {
      happy:       'A gentle, happy smile. Lift corners of the mouth slightly.',
      sad:         'A subtle sad expression. Turn the corners of the mouth down slightly.',
      encouraging: 'A warm, encouraging smile.',
      neutral:     'A calm, neutral expression.'
    };
    const editBody = {
      taskType: "INPAINTING",
      inputImage: imageBase64.split(',')[1] || imageBase64,
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
    const imgCmd = new InvokeModelCommand({
      modelId: 'stability.stable-diffusion-xl-v1',
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(editBody)
    });

    let imageOut = '';
    try {
      const imgResp = await bedrock.send(imgCmd);
      const bin = await imgResp.body.transformToByteArray(); // octet-stream
      imageOut = Buffer.from(bin).toString('base64');
    } catch (e) {
      console.error('圖像編輯失敗', e);
    }

    // 3. 回前端：文字 + 圖片
    res.json({
      idol_reply: idolReply,
      image_base64: imageOut
    });

  } catch (err) {
    console.error('全流程錯誤', err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
