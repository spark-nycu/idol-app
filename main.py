from fastapi import FastAPI, Form
from fastapi.middleware.cors import CORSMiddleware
import boto3
import json
import requests
import base64

app = FastAPI()

# 加 CORS 設定 (這樣 file:// 或 localhost 打API都不會403)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 黑客松Demo版允許全部來源
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# AWS 連線
session = boto3.Session(
    aws_access_key_id="ASIAW4KCJB3CVIOK3UZF",
    aws_secret_access_key="zHLo64g9KAnqfbgOuj7rfHbmGUex9AMQP8syM1xj",
    aws_session_token="IQoJb3JpZ2luX2VjEKX//////////wEaCXVzLWVhc3QtMSJHMEUCICZ3SwsIb+UcTNFtQL2Uin+jqpv64hpv8ryElytIdWY/AiEAphipp5NLmnxEsygewdKW991JT8GTtRyez6FX50fl/MkqmQIIPhAAGgw0NzMxMjIyNzkxMDkiDErF7/192wnKzF/qjCr2AYVXqKLz2TJr5awCvIfn9WbL5bmndfExa6i53puu68paQytWei/MLKL/dEvT8DGg+y09BefKGXCrcUV2bIiBBD1MW2B8+W88zFwEKZSsiFwLgGx/Bv4CslP/nPFpd5iDecUAjvfNT/txgG/nWfslKtZp55Nz0afc5iCPfNPpqAunVed9ttSu80GTWYa2CXjv93w015MQDl6L32ZpzQBuCFS9ecxR48U5P5mwAnLxc6mvMH9cYl0L2ok/vCsbgVCXE7bUVxNO+jDY+ycygEP/vD1b42cuTmgSWncCqiZDNedv4GlMUL7AdrcFT333oQeE9SFwGi202jDLz7HABjqdAWAI7AuJvFpWuRUHQbXAGEDshgzfepKeI9ohDLNxpb9ZQ6v+4cRUawQiABbyAcieFuD3USkMQykVE1syXw3XqVBD3slv8Jw4g9h8BzrL+yXjIhDdJQUFO81Xo8bZ+3WebS1twuX2RaQZyHlpR1krnol/76yYtDwvh8XqowctvpCfDT+Vj9xLXN55MpGQwm4+q+3bxgi7mflIFLrytwQ=",
    region_name="us-west-2"
)

bedrock = session.client('bedrock-runtime')



# Gamania Voice API設定
VOICE_API_URL = "https://persona-sound.data.gamania.com/api/v1/public/voice"
VOICE_API_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJjbGllbnRfaWQiOiJhd3NfaGFja2F0aG9uIiwiZXhwaXJlcyI6MTc0NTc0ODAwMH0.9qpg1xraE_d_Hua2brAmCfRlQSce6p2kdipgq8j1iqo"  # <-- 要換成你的token
SPEAKER_NAME = "chiachi"  # 你選的角色，比如家齊
MODEL_ID = 4  # 對應角色ID

def classify_emotion(text):
    text = text.lower()
    if any(word in text for word in ["加油", "鼓勵", "元氣"]):
        return "encouraging"
    elif any(word in text for word in ["開心", "快樂", "棒", "好開心"]):
        return "happy"
    elif any(word in text for word in ["難過", "失敗", "累了", "想哭", "傷心"]):
        return "sad"
    else:
        return "neutral"

def synthesize_with_gamania(text):
    headers = {
        "Authorization": f"Bearer {VOICE_API_TOKEN}",
        "Accept": "application/json",
        "Content-Type": "application/json"
    }
    params = {
        "text": text,
        "model_id": MODEL_ID,
        "speaker_name": SPEAKER_NAME,
        "speed_factor": 1,
        "mode": "stream"
    }

    response = requests.get(VOICE_API_URL, headers=headers, params=params)
    if response.status_code == 200:
        return response.content
    else:
        raise Exception(f"Voice API Error: {response.status_code}, {response.text}")

@app.post("/idol-reply")
async def idol_reply(message: str = Form(...)):
    try:
        # Step 1: Bedrock生成偶像回應文字
        bedrock_body = {
            "messages": [
                {
                    "role": "user",
                    "content": f"你是一位受人喜愛的虛擬偶像。收到以下粉絲訊息後，請用溫暖自然、輕鬆、正能量的語氣做出簡短的回應。\n粉絲訊息：「{message}」"
                }
            ]
        }
        bedrock_response = bedrock.invoke_model(
            modelId='arn:aws:bedrock:us-west-2:473122279109:inference-profile/us.amazon.nova-pro-v1:0',
            contentType='application/json',
            accept='application/json',
            body=json.dumps(bedrock_body)
        )

        result = json.loads(bedrock_response['body'].read())
        idol_reply = result['outputText'].strip()

        # Step 2: 情緒分類
        emotion = classify_emotion(idol_reply)

        # Step 3: 調用Gamania Voice API生成偶像語音
        audio_binary = synthesize_with_gamania(idol_reply)
        audio_base64 = base64.b64encode(audio_binary).decode('utf-8')

        # Step 4: 根據情緒生成偶像表情圖片
        emotion_prompt = {
            "happy": "smiling brightly, colorful dreamy anime background",
            "sad": "slightly teary but brave, soft pastel background",
            "encouraging": "confident cheering, vivid cute background",
            "neutral": "gentle calm expression, dreamy background"
        }.get(emotion, "gentle calm expression, dreamy background")

        image_body = {
            "text_prompts": [
                {
                    "text": f"A portrait of a virtual idol girl, {emotion_prompt}."
                }
            ],
            "cfg_scale": 10,
            "seed": 0,
            "steps": 50
        }

        image_response = bedrock.invoke_model(
            modelId='us.amazon.nova-pro-v1:0',
            contentType='application/json',
            accept='application/json',
            body=json.dumps(image_body)
        )
        image_binary = image_response['body'].read()
        image_base64 = base64.b64encode(image_binary).decode('utf-8')

        # Step 5: 回傳結果
        return {
            "idol_reply": idol_reply,
            "audio_base64": audio_base64,
            "image_base64": image_base64
        }

    except Exception as e:
        return {"error": f"伺服器錯誤：{str(e)}"}
    
@app.get("/")
async def root():
    return {"message": "Hello Idol"}
