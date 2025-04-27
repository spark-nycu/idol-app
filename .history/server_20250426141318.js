// server.js

const express = require('express');
const cors = require('cors');
const AWS = require('aws-sdk');
const axios = require('axios');
const bodyParser = require('body-parser');
const { Buffer } = require('buffer');

const app = express();

// CORS 設定（對應 main.py 的 CORSMiddleware） :contentReference[oaicite:0]{index=0}&#8203;:contentReference[oaicite:1]{index=1}
app.use(cors());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// AWS 連線設定 :contentReference[oaicite:2]{index=2}&#8203;:contentReference[oaicite:3]{index=3}
AWS.config.update({
  accessKeyId: 'ASIAW4KCJB3CVIOK3UZF',
  secretAccessKey: 'zHLo64g9KAnqfbgOuj7rfHbmGUex9AMQP8syM1xj',
  sessionToken: 'IQoJb3JpZ2luX2VjEKX//////////wEaCXVzLWVhc3QtMSJHMEUCICZ3SwsIb+UcTNFtQL2Uin+jqpv64hpv8ryElytIdWY/AiEAphipp5NLmnxEsygewdKW991JT8GTtRyez6FX50fl/MkqmQIIPhAAGgw0NzMxMjIyNzkxMDkiDErF7/192wnKzF/qjCr2AYVXqKLz2TJr5awCvIfn9WbL5bmndfExa6i53puu68paQytWei/MLKL/dEvT8DGg+y09BefKGXCrcUV2bIiBBD1MW2B8+W88zFwEKZSsiFwLgGx/Bv4CslP/nPFpd5iDecUAjvfNT/txgG/nWfslKtZp55Nz0afc5iCPfNPpqAunVed9ttSu80GTWYa2CXjv93w015MQDl6L32ZpzQBuCFS9ecxR48U5P5mwAnLxc6mvMH9cYl0L2ok/vCsbgVCXE7bUVxNO+jDY+ycygEP/vD1b42cuTmgSWncCqiZDNedv4GlMUL7AdrcFT333oQeE9SFwGi202jDLz7HABjqdAWAI7AuJvFpWuRUHQbXAGEDshgzfepKeI9ohDLNxpb9ZQ6v+4cRUawQiABbyAcieFuD3USkMQykVE1syXw3XqVBD3slv8Jw4g9h8BzrL+yXjIhDdJQUFO81Xo8bZ+3WebS1twuX2RaQZyHlpR1krnol/76yYtDwvh8XqowctvpCfDT+Vj9xLXN55MpGQwm4+q+3bxgi7mflIFLrytwQ='
});
const bedrock = new AWS.BedrockRuntime({ region: 'us-west-2' });

// Gamania Voice API 設定 :contentReference[oaicite:4]{index=4}&#8203;:contentReference[oaicite:5]{index=5}
const VOICE_API_URL = 'https://persona-sound.data.gamania.com/api/v1/public/voice';
const VOICE_API_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJjbGllbnRfaWQiOiJhd3NfaGFja2FjaGF0aG9uIiwiZXhwaXJlcyI6MTc0NTc0ODAwMH0.9qpg1xraE_d_Hua2brAmCfRlQSce6p2kdipgq8J1iqo';
const SPEAKER_NAME = 'chiachi';
const MODEL_ID = 4;

// 情緒分類函式 :contentReference[oaicite:6]{index=6}&#8203;:contentReference[oaicite:7]{index=7}
function classifyEmotion(text) {
  const t = text.toLowerCase();
  if (['加油','鼓勵','元氣'].some(w => t.includes(w))) return 'encouraging';
  if (['開心','快樂','棒','好開心'].some(w => t.includes(w))) return 'happy';
  if (['難過','失敗','累了','想哭','傷心'].some(w => t.includes(w))) return 'sad';
  return 'neutral';
}

// 語音合成呼叫 :contentReference[oaicite:8]{index=8}&#8203;:contentReference[oaicite:9]{index=9}
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
  return resp.data; // Buffer
}

app.post('/idol-reply', async (req, res) => {
  try {
    const message = req.body.message;

    // 1. Bedrock 文字回應 :contentReference[oaicite:10]{index=10}&#8203;:contentReference[oaicite:11]{index=11}
    const bedrockBody = {
      messages: [{
        role: 'user',
        content: `你是一位受人喜愛的虛擬偶像。收到以下粉絲訊息後，請用溫暖自然、輕鬆、正能量的語氣做出簡短的回應。\n粉絲訊息：「${message}」`
      }]
    };
    const invokeParamsText = {
      modelId: 'arn:aws:bedrock:us-west-2:473122279109:inference-profile/us.amazon.nova-pro-v1:0',
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(bedrockBody)
    };
    const textResp = await bedrock.invokeModel(invokeParamsText).promise();
    const textResult = JSON.parse(textResp.body.toString());
    const idolReply = textResult.outputText.trim();

    // 2. 情緒分類
    const emotion = classifyEmotion(idolReply);

    // 3. 語音合成
    const audioBuffer = await synthesizeWithGamania(idolReply);
    const audioBase64 = Buffer.from(audioBuffer).toString('base64');

    // 4. 圖像生成 :contentReference[oaicite:12]{index=12}&#8203;:contentReference[oaicite:13]{index=13}
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
      modelId: 'us.amazon.nova-pro-v1:0',
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(imageBody)
    };
    const imgResp = await bedrock.invokeModel(invokeParamsImage).promise();
    const imageBase64 = Buffer.from(imgResp.body).toString('base64');

    // 回傳 JSON
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

// 健康檢查
app.get('/', (req, res) => res.json({ message: 'Hello Idol' }));

// 啟動 Server
const PORT = 8000;
app.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
