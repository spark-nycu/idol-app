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
app.use(bodyParser.json({ limit: '15mb' }));

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

    // 1. 用 Claude 生成文字回覆
    let idolReply = '';
    let emotion = 'neutral';
    try {
      const textBody = {
        messages: [{
          role: 'user',
          content: `你是一位受人喜愛的虛擬偶像。請用溫暖正能量的語氣回覆：\n粉絲：「${message}」`
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
      console.error('▶️ 文字生成失敗', e);
      idolReply = '嗨～謝謝你的訊息！';
    }

    // 2. 用 Titan G1 v2 做局部 In-Painting（只改表情不換臉）
    const prompts = {
      happy:       'A gentle, happy smile. Lift the corners of the mouth slightly.',
      sad:         'A subtle sad expression. Turn the corners of the mouth downward slightly.',
      encouraging: 'A warm, encouraging smile.',
      neutral:     'A calm, neutral expression.'
    };
    const body = {
      task_type: "inpainting",
      // 去掉前缀 "data:image/xx;base64,"
      input_image: imageBase64.split(',')[1] || imageBase64,
      // 自动识别人脸区域作为 mask
      mask_prompt: "face",
      text_prompts: [
        { text: prompts[emotion] }
      ],
      negative_text_prompts: [
        { text: "different face, horror, exaggerated expression, deformed face" }
      ],
      cfg_scale: 7,
      steps: 60,
      seed: 0
    };
    const imgCmd = new InvokeModelCommand({
      modelId: 'amazon.titan-image-generator-v1',  // Titan G1 v2
      contentType: 'application/json',
      accept: 'application/octet-stream',
      body: JSON.stringify(body)
    });

    let imageOut = '';
    try {
      const imgResp = await bedrock.send(imgCmd);
      // octet-stream -> byte array
      const bytes = await imgResp.body.transformToByteArray();
      imageOut = Buffer.from(bytes).toString('base64');
    } catch (e) {
      console.error('▶️ 图像编辑失败', e);
    }

    // 3. 返回前端
    res.json({
      idol_reply: idolReply,
      image_base64: imageOut
    });

  } catch (err) {
    console.error('❌ /idol-reply 全流程错误', err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
