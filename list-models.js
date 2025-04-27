// list-models.js

require('dotenv').config();
const {
  BedrockClient,
  ListFoundationModelsCommand
} = require('@aws-sdk/client-bedrock');

async function listModels() {
  // 1️⃣ 建立 BedrockClient，指定區域
  const client = new BedrockClient({ region: process.env.AWS_REGION || 'us-east-1' });

  // 2️⃣ 建立 ListFoundationModelsCommand，這裡可以加 filter 或分頁參數
  const cmd = new ListFoundationModelsCommand({
    // MaxResults: 100,        // 最多拿 100 筆
    // NextToken: '...',       // 如果要分頁，帶上一次回傳的 NextToken
    // ProviderName: 'Amazon', // 或 'StabilityAI' / 'Anthropic' 等
  });

  try {
    // 3️⃣ 呼叫 send 拿回結果
    const resp = await client.send(cmd);

    // 4️⃣ 讀取 modelSummaries 欄位
    const models = resp.modelSummaries || [];
    console.log(`Found ${models.length} models:`);
    models.forEach(m => {
      console.log(`• ${m.modelId} (${m.providerName}) — ${m.modelArn}`);
    });

    // 如果還有 NextToken，可繼續分頁
    if (resp.nextToken) {
      console.log('還有更多 models，可帶 NextToken 分頁：', resp.nextToken);
    }
  } catch (err) {
    console.error('列出模型失敗', err);
  }
}

listModels();
