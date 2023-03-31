import { Server } from "socket.io";


export class ChatServer {

}


const io = new Server({
  path: '/helloboss-chat-service/socket.io/'
});

io.on("connection", (socket) => {
  console.log(`<====connection: ${socket.id}`)
  socket.on('msg', (msg) => {
    console.log(`socket.on(msg): ${JSON.stringify(msg)}`)
  })
  socket.on("disconnecting", (reason) => {
    console.log(`<====disconnecting: ${reason}`)
  });
});
io.listen(80);

