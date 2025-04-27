// server.js
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const axios = require('axios');
const { Buffer } = require('buffer');
const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const fs = require('fs');
const path = require('path');

// ==== AWS & Bedrock Setup ====
const REGION = process.env.AWS_REGION || 'us-west-2';
const bedrock = new BedrockRuntimeClient({ region: REGION });

// ==== Gamania TTS Setup ====
const VOICE_API_URL = 'https://persona-sound.data.gamania.com/api/v1/public/voice';
const VOICE_API_TOKEN = process.env.VOICE_API_TOKEN;
const SPEAKER_NAME = 'junting';
const TTS_MODEL_ID = 5;

async function synthesizeWithGamania(text) {
  // 確保文字不含多餘前綴
  // 可以檢查並移除不必要的前綴
  if (text.startsWith('陳俊廷')) {
    text = text.replace(/^陳俊廷[\s:]*/i, '');
  }
  
  const resp = await axios.get(VOICE_API_URL, {
    headers: {
      'Authorization': `Bearer ${VOICE_API_TOKEN}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    },
    params: { 
      text, // 確保這裡只有需要轉換的文字
      model_id: TTS_MODEL_ID, 
      speaker_name: SPEAKER_NAME, 
      speed_factor: 1, 
      mode: 'stream' 
    },
    responseType: 'arraybuffer'
  });
  return resp.data;
}

// ==== Helper: AI-based Emotion Classification ====
async function classifyEmotionAI(text) {
  const prompt = `Please classify the sentiment of the following text as one of exactly: happy, sad, angry, encouraging, shy, laughing, or neutral. Respond with only the label without additional text.\n\nText: "${text}"`;
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

// ==== Express App ====
const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '20mb' }));

// 在 Express 應用中添加靜態檔案中間件
app.use(express.static(__dirname));

app.post('/idol-reply', async (req, res) => {
  try {
    const { message, imageBase64 } = req.body;

    // 檢查 message 參數
    if (!message) {
      return res.status(400).json({ error: '需要 message' });
    }

    // 直接讀取本地圖片檔案
    let processedImage;
    try {
      // 硬編碼路徑或從請求中獲取 (若提供)
      const imagePath = path.join(__dirname, 'chiachi.jpg');
      const imageBuffer = fs.readFileSync(imagePath);
      processedImage = imageBuffer.toString('base64');
      console.log('已成功讀取本地圖片並轉換為 base64');
    } catch (fileError) {
      console.error('讀取本地圖片失敗:', fileError);
      return res.status(500).json({ error: '圖片處理失敗' });
    }

    // 1️⃣ Generate reply text with Claude
    let idolReply = '';
    try {
      const textBody = {
        messages: [{ role: 'user', content: `Do not include any stage directions or text wrapped in asterisks; output only the spoken reply content.
 You are emulating a real Taiwanese male idol. 
 他叫陳俊廷，是FEniX的5位成員之一。
 以下是他的一部分對話，請你模仿他的語氣和說話習慣
 "對前面還有一堆徵選，而且他的徵選不是一兩次，差不多進行了像浦洋，他是第一批，我大概試了五次。因為中間有疫情，所以又暫停
我試了大概五次，主要是因為我們有分八個星球，所以它有八種風格
只有他
但是中間的賽制會慢慢的淘汰淘汰淘汰
其實主要真的是因為因為我們火星剛開始就是在節目𥚃面太外放，就是大家都很嗨，就是很像一群不受控的小孩子，有點瘋，對非常。但是因為Max，他是走比較穩重路線，所以我們覺得他應該是比較最適合拿來管我們的
有嗎我們沒感覺
現在就是FEniX主要會以成熟穩重對對對
你也只大那一位九歲而已
他是他是
沒有 到現在還有一堆親朋好友問我說，欸你們年紀最大的是不是MAX
才藝嘛對不對 MAX
他是我們團內
對對沒錯
因為我覺得峻廷很像發言人，沒有因為我覺得老闆，老闆就是想要給他一種就是給他過敏的體質
老闆就是想要找一點華語流行的歌曲，讓他去挑戰看看
好想看穿著西裝跳芭蕾
喔我的專長喔
其實我的專長是戲劇啦對對對，因為我之前是華岡戲劇科，在學校有遇過啦，遇過但並不是認得，因為不同科系比較沒辦法接觸到，而且不同年級 對對對
我很怕他講出來其實我進去的時候，峻廷剛好畢業
其實是因緣巧合啦
"
 
 
 Please reply warmly and positively to the fan's message: "${message}"` }],
        max_tokens: 500,
        temperature: 0.7,
        anthropic_version: 'bedrock-2023-05-31'
      };
      const textCmd = new InvokeModelCommand({ modelId: 'anthropic.claude-3-haiku-20240307-v1:0', contentType: 'application/json', accept: 'application/json', body: JSON.stringify(textBody) });
      const txtResp = await bedrock.send(textCmd);
      const txtJson = JSON.parse(Buffer.from(txtResp.body).toString());
      idolReply = (txtJson.content?.[0]?.text || txtJson.outputText || '').trim();
      idolReply = idolReply.replace(/^\*[^*]+\*\s*/, '');
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
    const prompts = {
      happy: 'A genuine happy smile, keep identity absolutely unchanged. Chinese face',
      sad: 'A subtle sad expression, keep identity absolutely unchanged. Chinese face',
      angry: 'A mild angry expression with furrowed brows, keep identity absolutely unchanged. Chinese face',
      encouraging: 'An encouraging warm smile, keep identity absolutely unchanged. Chinese face',
      neutral: 'A calm neutral expression, keep identity absolutely unchanged. Chinese face',
      shy: 'A slightly blushing face with a gentle, bashful smile, looking down or away, keep identity absolutely unchanged. Chinese face',
      laughing: 'A wide, joyful smile with eyes crinkled in laughter, mouth open showing teeth, keep identity absolutely unchanged. Chinese face'
  };
    const inpaintPrompt = prompts[emotion] || prompts.neutral;
    console.log('In-painting prompt:', inpaintPrompt);

    // 使用本地讀取的圖片，而不是從請求中獲取
    const inPaintingParams = { 
      image: processedImage, // 直接使用從文件讀取的 base64
      maskPrompt: 'face', 
      text: inpaintPrompt, 
      negativeText: 'distorted, horror, deformed' 
    };
    const seed = Math.floor(Math.random() * 1e9);
    console.log('Using random seed:', seed);
    const requestBody = { 
      taskType: 'INPAINTING', 
      inPaintingParams, 
      imageGenerationConfig: { 
        numberOfImages: 1, 
        height: 512, 
        width: 512, 
        cfgScale: 7.0,
        seed: seed 
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
