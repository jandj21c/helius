// 📦 환경변수 로드
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;
const MY_TOKEN = process.env.YOUR_TOKEN_ADDRESS; // MOON Token Mint

app.use(bodyParser.json());

// ✅ Birdeye에서 실시간 가격 조회
async function getTokenPriceUsd(tokenMint) {
  try {
    const res = await axios.get('https://public-api.birdeye.so/public/price', {
      params: { address: tokenMint },
      headers: { 'X-API-KEY': process.env.BIRDEYE_API_KEY || '' },
    });
    return res.data?.data?.value || 0;
  } catch (e) {
    console.error("❌ Birdeye 가격 조회 실패:", e.message);
    return 0;
  }
}

// ✅ 텔레그램 대신 콘솔로 출력
async function sendTelegram(text, imagePath) {
  //console.log("📨 (텔레그램 메시지 전송 대신 로그 출력):\n", text);
  // 실제 전송을 원할 경우 아래 코드 주석 해제
  //const url = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;

  const url = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendPhoto`;

  const form = new FormData();
  form.append('chat_id', process.env.TELEGRAM_CHAT_ID); //test 1:1 7709221020
  form.append('caption', text);
  form.append('parse_mode', 'Markdown');
  form.append('photo', fs.createReadStream(imagePath));

  try {
    const res = await axios.post(url, form, {
      headers: form.getHeaders()
    });
    console.log('✅ 이미지와 함께 메시지 전송 성공:', res.data);
  } catch (err) {
    console.error('❌ 전송 실패:', err.response?.data || err.message);
  }

}

// ✅ Webhook 수신
app.post('/webhook', async (req, res) => {
  const payload = Array.isArray(req.body) ? req.body : [req.body];

  //console.log("📥 수신된 Webhook 데이터:", JSON.stringify(payload, null, 2));

  for (const data of payload) {
    const source = (data.source || '').toLowerCase();
    const transfers = data.tokenTransfers || [];
    const natives = data.nativeTransfers || [];

    if (!['raydium', 'jupiter'].includes(source)) {
      console.log(`⛔ source(${source}) 무시됨`);
      continue;
    }

    const buy = transfers.find(t =>
      t.mint === MY_TOKEN &&
      t.toUserAccount !== t.fromUserAccount &&
      Number(t.tokenAmount) > 0
    );
    if (!buy) {
      console.log("🧐 MOON 매수 아님 (toUserAccount 기준) → 무시됨");
      continue;
    }

    const buyer = buy.toUserAccount;
    const tokenAmount = Number(buy.tokenAmount);

    const usdcPaid = transfers.find(t =>
      t.tokenSymbol === 'USDC' && t.fromUserAccount === buyer
    );

    const solPaid = transfers.find(t =>
      t.mint === 'So11111111111111111111111111111111111111112' &&
      t.fromUserAccount === buyer
    );

    let passesThreshold = false;
    let paymentText = '';

    if (usdcPaid) {
      const usdcAmount = Number(usdcPaid.tokenAmount);
      paymentText = `${usdcAmount.toFixed(2)} USDC`;
      passesThreshold = usdcAmount >= 10;
    } else if (solPaid) {
      const solAmount = Number(solPaid.tokenAmount);
      paymentText = `${solAmount.toFixed(4)} SOL`;
      passesThreshold = solAmount >= 0.00001;
    }

    if (!passesThreshold) {
      console.log("⏹️ 알림 조건 미달: 소액 거래 무시");
      continue;
    }

    //const moonPriceUsd = await getTokenPriceUsd(MY_TOKEN);
    //const totalUsd = tokenAmount * moonPriceUsd;
    const emoji = tokenAmount > 10000 ? "🐳" : tokenAmount > 1000 ? "🦈" : "🟢";
    const signature = data.signature;
    const solscanUrl = `https://solscan.io/tx/${signature}`;
    const timestamp = new Date(data.timestamp * 1000).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });

    var imagePath;
    var title;
    if(Number(solPaid.tokenAmount) > 28) {
      imagePath = path.join(__dirname, 'images', 'big_whale.jpeg.jpg'); // 대왕고래
      title = '🐋🐋🐋대왕고래 출현🐋🐋🐋';
    }
    else {
      imagePath = path.join(__dirname, 'images', 'whale.jpeg.jpg'); // 돌고래
      title = 'BUY Detected!';
    }

    const msg = `💰 *${source.toUpperCase()} ${title}}*
👤 Buyer : \`${buyer.slice(0, 6)}...${buyer.slice(-4)}\`
🪙 Amount: ${emoji} ${tokenAmount.toFixed(2)} MOON
💵 Payment: ${paymentText}
🕒 Time: ${timestamp}
🔗 [View on Solscan](${solscanUrl})`;

//💲 단가: $${moonPriceUsd.toFixed(6)} / MOON
//💰 총액: $${totalUsd.toFixed(2)} USD

    await sendTelegram(msg, imagePath);
  }

  res.sendStatus(200);
});

// ✅ 서버 시작
app.listen(PORT, () => {
  console.log(`🚀 Webhook 수신 서버 실행 중: http://localhost:${PORT}`);
});