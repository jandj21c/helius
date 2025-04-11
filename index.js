require('dotenv').config();
const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT;
const MY_TOKEN = process.env.YOUR_TOKEN_ADDRESS;

app.use(bodyParser.json());

// 📌 실시간 가격 조회 (Birdeye)
async function getTokenPriceUsd(tokenMint) {
  console.log("⏹️ 가격 조회");
  try {
    const res = await axios.get('https://public-api.birdeye.so/public/price', {
      params: { address: tokenMint },
      headers: {
        'X-API-KEY': process.env.BIRDEYE_API_KEY || '',
      },
    });
    return res.data?.data?.value || 0;
  } catch (e) {
    console.error("❌ 가격 조회 실패:", e.message);
    return 0;
  }
}

// 📌 텔레그램 대신 로그 출력
async function sendTelegram(text) {
  console.log("📨 (텔레그램 메시지 전송 대신 로그 출력):\n", text);

  /*
  const url = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  try {
    await axios.post(url, {
      chat_id: process.env.TELEGRAM_CHAT_ID,
      text,
      parse_mode: "Markdown"
    });
    console.log("✅ 알림 전송 완료");
  } catch (e) {
    console.error("❌ 텔레그램 전송 실패:", e.message);
  }
  */
}

// 📌 Webhook 처리
app.post('/webhook', async (req, res) => {
  console.log("⏹️ 알림 발생");
  const data = req.body;

  if (data.type !== 'SWAP' || data.source !== 'raydium') {
    return res.sendStatus(200);
  }

  const transfers = data.tokenTransfers || [];
  const natives = data.nativeTransfers || [];

  const buy = transfers.find(t =>
    t.mint === MY_TOKEN &&
    t.destinationOwner !== t.sourceOwner &&
    parseFloat(t.amount) > 0
  );

  if (!buy) return res.sendStatus(200);
  const buyer = buy.destinationOwner;

  const usdcPaid = transfers.find(t =>
    t.tokenSymbol === 'USDC' &&
    t.sourceOwner === buyer
  );

  const solPaid = natives.find(t =>
    t.fromUserAccount === buyer &&
    parseInt(t.amount || 0) > 0
  );

  // 수량 계산
  const tokenAmount = Number(buy.amount) / Math.pow(10, buy.decimals || 9);
  console.log(`⏹️ 수량 : ${tokenAmount} `);

  // 결제 수단 파악 및 조건 필터
  let paymentText = "";
  let passesThreshold = false;

  if (usdcPaid) {
    const usdcAmount = Number(usdcPaid.amount) / Math.pow(10, usdcPaid.decimals || 6);
    paymentText = `${usdcAmount.toFixed(2)} USDC`;
    passesThreshold = usdcAmount >= 10;
  } else if (solPaid) {
    const solAmount = Number(solPaid.amount) / 1_000_000_000;
    paymentText = `${solAmount.toFixed(4)} SOL`;
    passesThreshold = solAmount >= 0.0001;
  }

  if (!passesThreshold) {
    console.log("⏹️ 알림 조건 미달: 소액 거래 무시");
    return res.sendStatus(200);
  }

  // 실시간 MOON 가격 조회
  const moonPriceUsd = await getTokenPriceUsd(MY_TOKEN);
  const totalUsd = tokenAmount * moonPriceUsd;

  // 이모지 분류
  let emoji = "🟢";
  if (tokenAmount > 10000) emoji = "🐳";
  else if (tokenAmount > 1000) emoji = "🦈";

  // 트랜잭션 정보
  const signature = data.signature;
  const solscanUrl = `https://solscan.io/tx/${signature}`;
  const timestamp = new Date(data.timestamp * 1000).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });

  const msg = `💰 *Raydium 매수 발생!*
👤 바이어: \`${buyer.slice(0, 6)}...${buyer.slice(-4)}\`
🪙 수량: ${emoji} ${tokenAmount.toFixed(2)} ${buy.tokenSymbol}
💵 지불: ${paymentText}
💲 단가: $${moonPriceUsd.toFixed(6)} / ${buy.tokenSymbol}
💰 총액: $${totalUsd.toFixed(2)} USD
🕒 시각: ${timestamp}
🔗 [Solscan에서 보기](${solscanUrl})`;

  await sendTelegram(msg);
  res.sendStatus(200);
});

// 📌 서버 실행
app.listen(PORT, () => {
  console.log(`🚀 Webhook 서버 실행 중: http://localhost:${PORT}`);
});
