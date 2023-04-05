import { io } from "socket.io-client"; 

const chatServiceUrl = "http://localhost";

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

interface User {
  id: number, 
  token: string,
}

async function receiver(user: User) {
  console.log(`receiver ${user.id} start`);
  const socket = io(chatServiceUrl
    , {
      auth: {
        token: user.token,
        version: '2',
        app: 'boss',
      }
    });
  socket.on('msg', function (msg) {
    console.log(`user ${user.id} 收到msg: <== ${JSON.stringify(msg)}`);
    const reply = {
      app: 'boss',
      target: msg.source,
      content: `${msg.content} - reply!!!`,
      type: 0,
      id: new Date().getTime()+'',
    };
    socket.emit('msg', reply);
    console.log(`user ${user.id} 发送msg: ===> ${JSON.stringify(reply)}`);
  });

  socket.on('user', function (msg) {
    console.log(`user ${user.id} 收到user事件:${JSON.stringify(msg)}`);
  });

  socket.on('rec', function (msg) {
    console.log(`user ${user.id} 收到rec事件:${JSON.stringify(msg)}`);
  });
}

async function sender(sender: User, receiver: User){
  console.log(`sender ${sender.id} start`);
  const socket = io(chatServiceUrl
    , {
      auth: {
        token: sender.token,
        version: '2',
        app: 'boss',
      }
    });

  socket.on('msg', function (msg) {
    console.log(`user ${sender.id} 收到msg: <== ${JSON.stringify(msg)}`);
    socket.emit('rec', {id: msg.id});
    console.log(`user ${sender.id} 发送回执rec: ==> ${JSON.stringify( {id: msg.id})}`);
  });
  socket.on('hb', function (msg) {
    console.log(`user ${sender.id} 收到hb回执: <== ${JSON.stringify(msg)}`);
  });
  socket.on('user', function (msg) {
    console.log(`user ${sender.id} 收到user事件:${JSON.stringify(msg)}`);
  });
  socket.on('rec', function (msg) {
    console.log(`user ${sender.id} 收到rec事件:${JSON.stringify(msg)}`);
  });

  for (let i = 0; i < 1; ++i) {
    const date = new Date();
    const msg = {
      id: new Date().getTime()+'',
      app: 'boss',
      target: receiver.id,
      content: `test for dev - ${date.getHours()}:${date.getMinutes()}:${date.getSeconds()}`,
      type: 0,
    };
    socket.emit('msg', msg);
    console.log(`user ${sender.id} 发送msg: ===> ${JSON.stringify(msg)}`)
    // await sleep(10);
  }
}

async function keepalive(sender: User, time: number){
  console.log(`keepalive ${sender.id} start`);
  const socket = io(chatServiceUrl
    , {
      auth: {
        token: sender.token,
        version: "2"
      }
    });

  socket.on('msg', function (msg) {
    console.log(`user ${sender.id} 收到msg: <== ${JSON.stringify(msg)}`);
    // socket.emit('rec', {id: msg.id});
    // console.log(`user ${sender.id} 发送回执rec: ==> ${JSON.stringify( {id: msg.id})}`);
  });
  socket.on('hb', function (msg) {
    console.log(`user ${sender.id} 收到hb回执: <== ${JSON.stringify(msg)}`);
  });
  socket.on('user', function (msg) {
    console.log(`user ${sender.id} 收到user事件:${JSON.stringify(msg)}`);
  });
  
  socket.on('rec', function (msg) {
    console.log(`user ${sender.id} 收到rec事件:${JSON.stringify(msg)}`);
  });

  while(true) {
    const msg = {id: new Date().getTime() + ""};
    socket.emit('hb', msg);
    console.log(`user ${sender.id} 发送心跳msg: ===> ${JSON.stringify(msg)}`);
    await sleep(time);
  }
}
