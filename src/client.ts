import { io } from "socket.io-client"; 

const chatServiceUrl = "http://localhost";

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
 
async function receiver(port: number, uid: string) {
  console.log(`receiver ${uid} start`);
  const socket = io(chatServiceUrl + ":" + port
    , {
      auth: {
        uid: uid
      }
    });
  socket.on('msg', function (msg) {
    console.log(`user ${uid} 收到msg: <== ${JSON.stringify(msg)}`);
  });
}

async function sender(port: number, senderUid: string, receiverUid: string){
  console.log(`sender ${senderUid} start`);
  const socket = io(chatServiceUrl + ":" + port
    , {
      auth: {
        uid: senderUid
      }
    });

  socket.on('msg', function (msg) {
    console.log(`user ${senderUid} 收到msg: <== ${JSON.stringify(msg)}`);
  });

  for (let i = 0; i < 1; ++i) {
    const date = new Date();
    const msg = {
      id: new Date().getTime()+'',
      target: receiverUid,
      content: `test for dev - ${date.getHours()}:${date.getMinutes()}:${date.getSeconds()}`,
    };
    socket.emit('msg', msg);
    console.log(`user ${senderUid} 发送msg: ===> ${JSON.stringify(msg)}`)
  }
}

async function keepalive(senderUid: string, time: number){
  console.log(`keepalive ${senderUid} start`);
  const socket = io(chatServiceUrl
    , {
      auth: {
        uid: senderUid
      }
    });
  socket.on('msg', function (msg) {
    console.log(`user ${senderUid} 收到msg: <== ${JSON.stringify(msg)}`);
  });
  socket.on('hb', function (msg) {
    console.log(`user ${senderUid} 收到hb回执: <== ${JSON.stringify(msg)}`);
  });
  while(true) {
    const msg = {id: new Date().getTime() + ""};
    socket.emit('hb', msg);
    console.log(`user ${senderUid} 发送心跳msg: ===> ${JSON.stringify(msg)}`);
    await sleep(time);
  }
}
const args = process.argv;
const serverPort = Number(args[2]);
const type = args[3];
const uid = args[4];
const uid2 = args[5];
if (type === "recv") {
  receiver(serverPort, uid);
} else if(type === "send") {
  sender(serverPort, uid, uid2);
}