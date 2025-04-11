// 📦 환경변수 로드
require('dotenv').config();
const express = require('express');
const axios = require('axios');
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
async function sendTelegram(text) {
  console.log("📨 (텔레그램 메시지 전송 대신 로그 출력):\n", text);
  /* 실제 전송을 원할 경우 아래 코드 주석 해제
  const url = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  await axios.post(url, {
    chat_id: process.env.TELEGRAM_CHAT_ID,
    text,
    parse_mode: "Markdown"
  });
  */
}

// ✅ Webhook 수신
app.post('/webhook', async (req, res) => {
  console.log("📦 수신된 Webhook 데이터:", JSON.stringify(req.body, null, 2));
  const data = req.body;
  const source = (data.source || '').toLowerCase();
  const transfers = data.tokenTransfers || [];
  const natives = data.nativeTransfers || [];

  // ✅ raydium, jupiter 이외의 출처는 무시
  if (!['raydium', 'jupiter'].includes(source)) {
    return res.sendStatus(200);
  }

  // ✅ MOON 토큰 수령 여부 확인 (매수 감지)
  const buy = transfers.find(t =>
    t.mint === MY_TOKEN &&
    t.toUserAccount !== t.fromUserAccount &&
    Number(t.tokenAmount) > 0
  );
  if (!buy) return res.sendStatus(200);

  console.log("⏹️ BUY 발생");

  const buyer = buy.toUserAccount;
  const tokenAmount = Number(buy.tokenAmount);

  // ✅ SOL 또는 USDC 지불 여부 감지
  const usdcPaid = transfers.find(t =>
    t.tokenSymbol === 'USDC' && t.fromUserAccount === buyer
  );

  const solPaid = transfers.find(t =>
    t.mint === 'So11111111111111111111111111111111111111112' &&
    t.fromUserAccount === buyer
  );

  // ✅ 최소 결제 조건 확인
  let passesThreshold = false;
  let paymentText = '';

  if (usdcPaid) {
    const usdcAmount = Number(usdcPaid.tokenAmount);
    paymentText = `${usdcAmount.toFixed(2)} USDC`;
    passesThreshold = usdcAmount >= 10;
  } else if (solPaid) {
    const solAmount = Number(solPaid.tokenAmount);
    paymentText = `${solAmount.toFixed(4)} SOL`;
    passesThreshold = solAmount >= 0.1;
  }

  if (!passesThreshold) {
    console.log("⏹️ 알림 조건 미달: 소액 거래 무시");
    return res.sendStatus(200);
  }

  // ✅ 가격 조회 및 메시지 구성
  const moonPriceUsd = await getTokenPriceUsd(MY_TOKEN);
  const totalUsd = tokenAmount * moonPriceUsd;
  const emoji = tokenAmount > 10000 ? "🐳" : tokenAmount > 1000 ? "🦈" : "🟢";
  const signature = data.signature;
  const solscanUrl = `https://solscan.io/tx/${signature}`;
  const timestamp = new Date(data.timestamp * 1000).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });

  const msg = `💰 *${source.toUpperCase()} 매수 발생!*
👤 바이어: \`${buyer.slice(0, 6)}...${buyer.slice(-4)}\`
🪙 수량: ${emoji} ${tokenAmount.toFixed(2)} MOON
💵 지불: ${paymentText}
💲 단가: $${moonPriceUsd.toFixed(6)} / MOON
💰 총액: $${totalUsd.toFixed(2)} USD
🕒 시각: ${timestamp}
🔗 [Solscan에서 보기](${solscanUrl})`;

  await sendTelegram(msg);
  res.sendStatus(200);
});

// ✅ 서버 시작
app.listen(PORT, () => {
  console.log(`🚀 Webhook 수신 서버 실행 중: http://localhost:${PORT}`);
});