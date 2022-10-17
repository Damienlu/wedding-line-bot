"use strict";
require("dotenv").config({path: '.env'});
// require("dotenv").config();

const line = require("@line/bot-sdk");
const axios = require("axios");
const admin = require("firebase-admin");

const express = require("express");
const cors = require("cors");

const { KEYWORD_COMPARISON } = require("./constants/keyword.ts");
const { MESSAGE_CONTENT } = require("./constants/message.ts");
const { DIRTY_WORDS } = require("./constants/dirty.ts");

// create LINE SDK config from env variables
const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};

// create LINE SDK client
const client = new line.Client(config);

// initialize firebase
admin.initializeApp({
  credential: admin.credential.cert({
    type: process.env.TYPE,
    project_id: process.env.PROJECT_ID,
    private_key_id: process.env.PRIVATE_KEY_ID,
    private_key: process.env.PRIVATE_KEY.replace(/\\n/g, "\n"),
    client_email: process.env.CLIENT_EMAIL,
    client_id: process.env.CLIENT_ID,
    auth_uri: process.env.AUTH_URI,
    token_uri: process.env.TOKEN_URI,
    auth_provider_x509_cert_url: process.env.AUTH_PROVIDER_X509_CERT_URL,
    client_x509_cert_url: process.env.CLIENT_X509_CERT_URL,
  }),
  databaseURL: process.env.DATABASE_URL,
});

// create Express app
const app = express();

app.use(cors());

// create variables

const messages = [];

const handleGetData = async (request, response) => {
  try {
    const citiesRef = admin.firestore().collection('messages');
    const snapshot = await citiesRef.get();
    const data = []
    snapshot.forEach(doc => {
      // console.log(doc.data());
      data.push(doc.data())
    });

    // console.log(result)
    const headers = {
      "Content-Type": "application/json",
      // Connection: "keep-alive",
      "Cache-Control": "no-cache",
      "Access-Control-Allow-Origin": "*"
    };
    response.writeHead(200, headers);

    const dataJSON = JSON.stringify({ data });
    
    response.write(dataJSON);
    return dataJSON
  } catch (error) {
    response.write(error)
    return error
  }
}

// register a webhook handler with middleware
// about the middleware, please refer to doc
// 給line bot
app.post("/", line.middleware(config), (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then((result) => res.json(result))
    .catch((err) => {
      res.status(500).end();
    });
});

// 給網頁彈幕
app.get("/messages", handleMessages);

// 給admin 顯示資料
app.get("/data", handleGetData)

// event handler
function handleEvent(event) {
  if (event.type !== "message" || event.message.type !== "text") {
    // ignore non-text-message event
    return Promise.resolve(null);
  }

  return axios
    .get(`https://api.line.me/v2/bot/profile/${event.source.userId}`, {
      headers: { Authorization: `Bearer ${process.env.CHANNEL_ACCESS_TOKEN}` },
    })
    .then((res) => {
      // filter dirty words
      const text = DIRTY_WORDS.reduce(
        (acc, item) => acc.replace(new RegExp(item), "*".repeat(item.length)),
        event.message.text
      );

      // echo message
      const echo = {
        type: "text",
        text: `${text} (已收到)`,
      };

      // mapping keyword
      const result = Object.keys(KEYWORD_COMPARISON).reduce((acc, keyword) => {
        if (acc === "" && text.includes(keyword)) {
          acc = MESSAGE_CONTENT[KEYWORD_COMPARISON[keyword]];
        }
        return acc;
      }, "");

      // server sent event and save in firebase
      const message = {
        ...res.data,
        text,
        createdAt: new Date().getTime(),
      };

      // 存入firebase
      admin.firestore().collection("messages").doc().set(message);
      // 存入message
      messages.push(message);

      // use reply API
      return client.replyMessage(event.replyToken, result || echo);
    })
    .catch((error) => { console.error(error) });
}


function handleMessages(request, response) {
  const headers = {
    "Content-Type": "text/event-stream",
    Connection: "keep-alive",
    "Cache-Control": "no-cache",
  };
  response.writeHead(200, headers);

  const timer = setInterval(() => {
    const data = `data: ${JSON.stringify({ messages })}\n\n`;

    response.write(data);

    // clear messages
    messages.length = 0;
  }, 1000);

  request.on("close", () => {
    clearInterval(timer);
  });
}

// listen on port
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`listening on ${port}`);
});

/**
 * message type
 *
 * sticker  => 貼圖
 * image    => 照片
 * video    => 影片
 * audio    => 語音
 * location => 座標
 *
 *
 *
 *
 * emoji
 *
 * https://d.line-scdn.net/r/devcenter/sendable_line_emoji_list.pdf
 *
 * example:
 *
 *  {
 *    type: 'text',
 *    text: '$ emoji $'
 *    emojis: [
 *      {
 *          index: 0,
 *          product: 'xxx'
 *          emojiId: '001
 *       },
 *       {
 *          index: 8,
 *          product: 'xxx'
 *          emojiId: '002
 *       }
 *    ]
 *  }
 */
